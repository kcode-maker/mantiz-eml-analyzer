/**
 * rulesStore.js — persistence for tagging rules and the "current match set"
 * of each rule, in IndexedDB (see db.js for the 'rules' / 'ruleMatches'
 * object stores).
 *
 * Tracking exactly which emails a rule matched (not just re-deriving it
 * every time) is what makes "disable a rule" instant and exact: instead of
 * re-scanning the whole folder to figure out what to untag, disabling just
 * removes the rule's tag from precisely the emails recorded here.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  function uuid() {
    return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  // Auto-generated rule tags follow the same name rules as every other tag (see EV.tags.normalizeName):
  // lowercase a-z, 0-9, hyphen and underscore, at most 40 characters.
  function slugify(name) {
    return String(name).toLowerCase().trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40).replace(/-+$/, '') || 'rule';
  }

  function matchKey(ruleId, emailId) {
    return ruleId + '|' + emailId;
  }

  EV.rulesStore = {
    slugify: slugify,

    list: function () {
      return EV.db.getAll('rules').then(function (rules) {
        return rules.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      });
    },

    get: function (id) {
      return EV.db.get('rules', id);
    },

    /** Picks a tag slug that doesn't collide with any other existing rule. */
    uniqueTag: function (desiredTag, excludeRuleId) {
      return EV.rulesStore.list().then(function (rules) {
        var taken = {};
        rules.forEach(function (r) { if (r.id !== excludeRuleId) taken[r.tag] = true; });
        var base = slugify(desiredTag);
        var tag = base;
        var n = 2;
        while (taken[tag]) { tag = base + '-' + n; n++; }
        return tag;
      });
    },

    create: function (fields) {
      var rule = {
        id: uuid(),
        name: fields.name,
        tag: fields.tag,
        expression: fields.expression,
        enabled: !!fields.enabled,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRun: null
      };
      return EV.db.put('rules', rule).then(function () { return rule; });
    },

    update: function (id, fields) {
      return EV.rulesStore.get(id).then(function (rule) {
        if (!rule) throw new Error('Rule not found: ' + id);
        var oldTag = rule.tag;
        Object.assign(rule, fields, { updatedAt: Date.now() });
        // A rule whose tag was deleted (blockedTag) stays off until its tag is changed to a different one.
        if (fields.tag !== undefined && fields.tag !== rule.blockedTag && !('blockedTag' in fields)) rule.blockedTag = null;
        if (rule.enabled && rule.blockedTag) {
          throw new Error('The tag "' + rule.blockedTag + '" was deleted, so this rule can\u2019t be enabled with it \u2014 edit the rule and choose a different tag first.');
        }
        var rename = (fields.tag && fields.tag !== oldTag)
          ? EV.rulesStore.renameTag(id, oldTag, fields.tag)
          : Promise.resolve();
        return rename.then(function () {
          return EV.db.put('rules', rule).then(function () { return rule; });
        });
      });
    },

    /** Called when a tag is deleted: every rule applying it (enabled or not) is switched off and marked so
     * it can't be re-enabled until it is given a different tag. Resolves to [{rule, wasEnabled}]. */
    blockRulesForDeletedTag: function (tagName) {
      return EV.rulesStore.list().then(function (rules) {
        var hit = rules.filter(function (r) { return r.tag === tagName; });
        return Promise.all(hit.map(function (r) {
          var wasEnabled = !!r.enabled;
          return EV.rulesStore.update(r.id, { enabled: false, blockedTag: tagName, lastRun: null }).then(function (rule) {
            return { rule: rule, wasEnabled: wasEnabled };
          });
        }));
      });
    },
    /** Undo of blockRulesForDeletedTag: lifts the block (the caller re-enables those that were enabled). */
    unblockRule: function (id) {
      return EV.rulesStore.update(id, { blockedTag: null });
    },

    /**
     * A rule's tag is user-editable, but its match-tracking records
     * (ruleMatches) only store *which emails* matched, not what the tag text
     * was at the time — so if the tag itself is renamed, every email this
     * rule previously tagged needs the old tag swapped for the new one
     * directly. Without this, the old tag would linger forever (the normal
     * add/remove diff on the next run only reacts to match *status*
     * changing, not to the configured tag string changing).
     */
    renameTag: function (ruleId, oldTag, newTag) {
      return EV.rulesStore.getMatchesForRule(ruleId).then(function (emailIds) {
        return Promise.all(emailIds.map(function (eid) {
          return EV.tags.removeTag(eid, oldTag, { type: 'rule', ruleId: ruleId }).then(function () {
            return EV.tags.addTag(eid, newTag, { type: 'rule', ruleId: ruleId });
          });
        }));
      });
    },

    setLastRun: function (id, stats) {
      return EV.rulesStore.get(id).then(function (rule) {
        if (!rule) return;
        rule.lastRun = stats;
        return EV.db.put('rules', rule);
      });
    },

    remove: function (id) {
      return EV.rulesStore.getMatchesForRule(id).then(function (emailIds) {
        return Promise.all(emailIds.map(function (eid) { return EV.db.delete('ruleMatches', matchKey(id, eid)); }));
      }).then(function () { return EV.db.delete('rules', id); });
    },

    // ---------- match-set tracking ----------

    getMatchesForRule: function (ruleId) {
      return EV.db.getAllByIndex('ruleMatches', 'by_rule', ruleId).then(function (records) {
        return records.map(function (r) { return r.emailId; });
      });
    },

    getAllMatches: function () {
      return EV.db.getAll('ruleMatches');
    },

    recordMatch: function (ruleId, emailId) {
      return EV.db.put('ruleMatches', { key: matchKey(ruleId, emailId), ruleId: ruleId, emailId: emailId });
    },

    unrecordMatch: function (ruleId, emailId) {
      return EV.db.delete('ruleMatches', matchKey(ruleId, emailId));
    },

    // ---------- export / import ----------

    exportJson: function () {
      return EV.rulesStore.list().then(function (rules) {
        return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), rules: rules }, null, 2);
      });
    },

    /**
     * Imports rules as brand-new rule definitions (fresh id, no match
     * history) rather than overwriting anything by id — an import is meant
     * to be portable across machines/browsers where ids from the source
     * profile mean nothing here. A rule whose tag already matches an
     * existing rule is skipped rather than creating a second rule fighting
     * over the same tag (the editor already prevents that combination from
     * being created by hand). Imported rules are NOT run automatically —
     * only created — so importing 20 rules doesn't kick off 20 sequential
     * full-folder scans; run them from the Rules panel when ready.
     */
    /** One-off: converts saved rules whose tag predates the tag-name rules (capitals, spaces, ...).
     * Only the rule's own tag text changes -- the tags already on emails are converted separately by
     * EV.tags.migrateLegacyNames, so this deliberately does not re-tag anything. Resolves to the
     * number of rules changed. */
    migrateTagNames: function () {
      return EV.rulesStore.list().then(function (rules) {
        var taken = {};
        rules.forEach(function (r) { if (r.tag === EV.tags.sanitizeLegacy(r.tag)) taken[r.tag] = true; });
        var changed = [];
        rules.forEach(function (r) {
          var fixed = EV.tags.sanitizeLegacy(r.tag);
          if (fixed === r.tag) return;
          var base = fixed, n = 2;
          while (taken[fixed]) { fixed = base + '-' + n; n++; }
          taken[fixed] = true;
          r.tag = fixed;
          changed.push(r);
        });
        return Promise.all(changed.map(function (r) { return EV.db.put('rules', r); })).then(function () { return changed.length; });
      });
    },

    importJson: function (jsonText) {
      var parsed = JSON.parse(jsonText);
      var incoming = parsed.rules || parsed;
      if (!Array.isArray(incoming)) throw new Error('Unrecognized rules export format');
      return EV.rulesStore.list().then(function (existing) {
        var takenTags = {};
        existing.forEach(function (r) { takenTags[r.tag] = true; });
        var toCreate = incoming.filter(function (r) { return r && r.name && r.expression && r.tag; })
          .map(function (r) { return Object.assign({}, r, { tag: EV.tags.sanitizeLegacy(r.tag) }); }); // old exports may hold invalid names
        var chain = Promise.resolve();
        var imported = 0, skipped = 0;
        toCreate.forEach(function (r) {
          chain = chain.then(function () {
            if (takenTags[r.tag]) { skipped++; return; }
            takenTags[r.tag] = true;
            imported++;
            return EV.rulesStore.create({ name: r.name, tag: r.tag, expression: r.expression, enabled: !!r.enabled });
          });
        });
        return chain.then(function () { return { imported: imported, skipped: skipped + (incoming.length - toCreate.length) }; });
      });
    }
  };
})(typeof self !== 'undefined' ? self : this);
