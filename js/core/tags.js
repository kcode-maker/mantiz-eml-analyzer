/**
 * tags.js — freeform tags + a note per email, persisted in IndexedDB.
 *
 * Keyed by the email's Message-ID when present (stable across re-opening the
 * same folder later), falling back to a fast content hash for messages that
 * lack one. Also supports exporting/importing the whole tag set as JSON so
 * it can be backed up or shared with a teammate without depending on any
 * particular browser profile.
 *
 * Provenance: a tag on an email comes from one of two places — typed in by
 * hand (`manualTags`), or applied by a tagging rule (`ruleTagOwners`, a map
 * of tag name -> the rule id(s) currently asserting it). Keeping these
 * separate is what lets disabling/deleting a rule retract exactly its own
 * tag without also stripping an identically-named tag the user typed in by
 * hand on the same email — before this, both lived in one flat `tags` array
 * with no record of which caller added which entry, so removeTag(id, 'x')
 * always deleted 'x' outright regardless of who else wanted it there.
 * Old records only have the flat `tags` array; they're treated as if every
 * entry in it were manual (the safe default — never silently attributes a
 * pre-existing tag to a rule that might then retract it later).
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  var STORE = 'tags';

  var TAG_COLORS = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#d19a66', '#ff7b72'];
  EV.tagColor = function (name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return TAG_COLORS[h % TAG_COLORS.length];
  };

  /** Brings an old-format ({id, tags:[...]}) or bare record up to the current shape, in place. */
  function migrate(rec) {
    if (!rec.manualTags) rec.manualTags = rec.tags ? rec.tags.slice() : [];
    if (!rec.ruleTagOwners) rec.ruleTagOwners = {};
    delete rec.tags; // superseded by manualTags/ruleTagOwners; recomputed for readers, see effectiveTags()
    return rec;
  }

  /** The tag names actually in effect for a record: manual ones, plus any rule still asserting one. */
  function effectiveTags(rec) {
    var manual = rec.manualTags || rec.tags || [];
    var ruleNames = Object.keys(rec.ruleTagOwners || {}).filter(function (t) {
      return (rec.ruleTagOwners[t] || []).length > 0;
    });
    var seen = {};
    var out = [];
    manual.concat(ruleNames).forEach(function (t) { if (!seen[t]) { seen[t] = true; out.push(t); } });
    return out;
  }

  /** Public read path: always exposes a computed, backward-compatible `.tags` (the effective union). */
  function withEffectiveTags(rec) {
    if (!rec) return rec;
    rec.tags = effectiveTags(rec);
    return rec;
  }

  function rawGet(id) {
    return EV.db.get(STORE, id);
  }

  function get(id) {
    return rawGet(id).then(withEffectiveTags);
  }

  /**
   * Writes a record, EXCEPT when it has come to hold no tags and no note —
   * then it's deleted instead. Without this, every rule that ever matched
   * an email and was later disabled/edited (removeTag empties it but a naive
   * put() would keep the now-empty record forever) leaves a useless husk
   * behind; over months of rule iteration on a large corpus that's
   * thousands of dead IndexedDB records and a bloated tag export.
   */
  function putOrPrune(record) {
    var hasTags = effectiveTags(record).length > 0;
    var hasNote = record.note && String(record.note).trim().length > 0;
    if (!hasTags && !hasNote) return EV.db.delete(STORE, record.id);
    record.updatedAt = Date.now();
    var toStore = { id: record.id, manualTags: record.manualTags || [], ruleTagOwners: record.ruleTagOwners || {}, note: record.note, updatedAt: record.updatedAt };
    return EV.db.put(STORE, toStore);
  }

  // ---------- tag-name rules ----------
  // One definition of what a tag name may be, used by every tag box, import, and rule save:
  // lowercase a-z, digits, hyphen and underscore; 1-40 characters; no spaces.
  var TAG_NAME_MAX = 40;
  var TAG_NAME_RE = /^[a-z0-9_-]+$/;

  /** Checks a typed tag name. Uppercase is folded to lowercase (not an error); anything else outside
   * the allowed set is refused with a message fit to show the user.
   * @returns {{ok:boolean, name:string, error:string}} */
  function normalizeName(raw) {
    var name = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!name) return { ok: false, name: '', error: 'Enter a tag name.' };
    if (/\s/.test(name)) return { ok: false, name: name, error: 'Spaces are not allowed \u2014 use - or _ instead (e.g. "set-1").' };
    if (!TAG_NAME_RE.test(name)) return { ok: false, name: name, error: 'Only a\u2013z, 0\u20139, - and _ are allowed.' };
    if (name.length > TAG_NAME_MAX) return { ok: false, name: name, error: 'Tag names can be at most ' + TAG_NAME_MAX + ' characters.' };
    return { ok: true, name: name, error: '' };
  }

  /** Forces ANY stored/imported name into the valid format (used to convert old tags and imports):
   * a name that is already valid is only lowercased; otherwise runs of invalid characters become one
   * hyphen, then it is trimmed to 40 characters. Never returns an empty name. */
  function sanitizeLegacy(raw) {
    var name = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!TAG_NAME_RE.test(name)) {
      name = name.replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    }
    name = name.slice(0, TAG_NAME_MAX).replace(/-+$/, '');
    return name || 'untagged';
  }

  /** Converts every name in one raw record in place; returns true if anything changed. */
  function sanitizeRecordNames(rec, renames) {
    var changed = false;
    function conv(n) {
      var c = sanitizeLegacy(n);
      if (c !== n) { changed = true; if (renames) renames[n] = c; }
      return c;
    }
    var manual = rec.manualTags || rec.tags || [];
    var manualOut = [];
    manual.forEach(function (t) { var c = conv(t); if (manualOut.indexOf(c) === -1) manualOut.push(c); });
    var owners = rec.ruleTagOwners || {};
    var ownersOut = {};
    Object.keys(owners).forEach(function (t) {
      var c = conv(t);
      var list = ownersOut[c] || (ownersOut[c] = []);
      (owners[t] || []).forEach(function (rid) { if (list.indexOf(rid) === -1) list.push(rid); });
    });
    rec.manualTags = manualOut;
    rec.ruleTagOwners = ownersOut;
    delete rec.tags;
    return changed;
  }

  /** @param {{type:'rule', ruleId:string}} [source]  omit (or {type:'manual'}) for a manually-typed tag */
  function isRuleSource(source) { return !!(source && source.type === 'rule' && source.ruleId); }

  EV.tags = {
    get: get,
    getAll: function () {
      return EV.db.getAll(STORE).then(function (records) { return records.map(withEffectiveTags); });
    },
    setTags: function (id, tagList) {
      // Replaces this email's MANUAL tags only — rule-applied tags are
      // managed exclusively by the rules engine and untouched by this call.
      return rawGet(id).then(function (rec) {
        rec = migrate(rec || { id: id });
        rec.manualTags = tagList.slice();
        return putOrPrune(rec);
      });
    },
    normalizeName: normalizeName,
    sanitizeLegacy: sanitizeLegacy,
    TAG_NAME_MAX: TAG_NAME_MAX,

    /** Adds a tag to one email. A manually typed name must already be valid (rejects with the message
     * normalizeName gives); a rule's own tag is converted instead, so a rule can never be stopped
     * mid-run by an odd name. */
    addTag: function (id, tag, source) {
      if (isRuleSource(source)) {
        tag = sanitizeLegacy(tag);
      } else {
        var chk = normalizeName(tag);
        if (!chk.ok) return Promise.reject(new Error(chk.error));
        tag = chk.name;
      }
      return rawGet(id).then(function (rec) {
        rec = migrate(rec || { id: id });
        if (isRuleSource(source)) {
          var owners = rec.ruleTagOwners[tag] || (rec.ruleTagOwners[tag] = []);
          if (owners.indexOf(source.ruleId) === -1) owners.push(source.ruleId);
        } else if (rec.manualTags.indexOf(tag) === -1) {
          rec.manualTags.push(tag);
        }
        return putOrPrune(rec);
      });
    },
    removeTag: function (id, tag, source) {
      return rawGet(id).then(function (rec) {
        if (!rec) return;
        rec = migrate(rec);
        if (isRuleSource(source)) {
          if (rec.ruleTagOwners[tag]) {
            rec.ruleTagOwners[tag] = rec.ruleTagOwners[tag].filter(function (rid) { return rid !== source.ruleId; });
            if (rec.ruleTagOwners[tag].length === 0) delete rec.ruleTagOwners[tag];
          }
        } else {
          rec.manualTags = rec.manualTags.filter(function (t) { return t !== tag; });
        }
        return putOrPrune(rec);
      });
    },
    /** Removes a tag from every record that currently has it, regardless of provenance (manual or
     * rule-applied) -- the Tags panel's "Delete tag" action. Deliberately does NOT touch the rule
     * itself: if a still-enabled rule asserts this tag, its next run simply re-applies it.
     * Resolves to {count, undo}: how many emails lost the tag, and a function that puts the tag back on
     * exactly those emails (manual or rule-owned, as each one had it). */
    deleteTag: function (tagName) {
      return EV.db.getAll(STORE).then(function (records) {
        var snapshot = [];
        var affected = records.filter(function (r) { return effectiveTags(r).indexOf(tagName) !== -1; });
        affected.forEach(function (r) {
          snapshot.push({
            id: r.id,
            manual: (r.manualTags || r.tags || []).indexOf(tagName) !== -1,
            owners: ((r.ruleTagOwners && r.ruleTagOwners[tagName]) || []).slice()
          });
        });
        return Promise.all(affected.map(function (r) {
          var rec = migrate(r);
          rec.manualTags = rec.manualTags.filter(function (t) { return t !== tagName; });
          delete rec.ruleTagOwners[tagName];
          return putOrPrune(rec);
        })).then(function () {
          return {
            count: affected.length,
            undo: function () {
              return Promise.all(snapshot.map(function (snap) {
                return rawGet(snap.id).then(function (rec) {
                  rec = migrate(rec || { id: snap.id });
                  if (snap.manual && rec.manualTags.indexOf(tagName) === -1) rec.manualTags.push(tagName);
                  if (snap.owners.length) {
                    var owners = rec.ruleTagOwners[tagName] || (rec.ruleTagOwners[tagName] = []);
                    snap.owners.forEach(function (rid) { if (owners.indexOf(rid) === -1) owners.push(rid); });
                  }
                  return putOrPrune(rec);
                });
              })).then(function () { return snapshot.length; });
            }
          };
        });
      });
    },
    /** Deletes several tags (one after another -- two tags often sit on the same email record, and a
     * record's read-modify-write must never run concurrently with itself). Resolves to
     * {results: [{name, count}], undo}; undo restores them one after another for the same reason. */
    deleteTags: function (tagNames) {
      var done = [];
      var chain = Promise.resolve();
      tagNames.forEach(function (name) {
        chain = chain.then(function () { return EV.tags.deleteTag(name); }).then(function (res) { done.push({ name: name, count: res.count, undo: res.undo }); });
      });
      return chain.then(function () {
        return {
          results: done.map(function (d) { return { name: d.name, count: d.count }; }),
          undo: function () {
            var restore = Promise.resolve();
            done.forEach(function (d) { restore = restore.then(d.undo); });
            return restore;
          }
        };
      });
    },
    /** Same as deleteTag, resolving to just the count. */
    removeTagEverywhere: function (tagName) {
      return EV.tags.deleteTag(tagName).then(function (r) { return r.count; });
    },
    /** Untags the given emails (by id) of a tag they hold MANUALLY. A tag a rule applies cannot be taken
     * off one email by hand (the rule would re-add it) -- those are counted separately so the UI can say so.
     * @returns {Promise<{removed:number, ruleOwned:number, absent:number}>} */
    removeManualTagFromMany: function (ids, tagName) {
      var res = { removed: 0, ruleOwned: 0, absent: 0 };
      var chain = Promise.resolve();
      ids.forEach(function (id) {
        chain = chain.then(function () {
          return rawGet(id).then(function (rec) {
            if (!rec) { res.absent++; return; }
            rec = migrate(rec);
            if (rec.manualTags.indexOf(tagName) !== -1) {
              rec.manualTags = rec.manualTags.filter(function (t) { return t !== tagName; });
              res.removed++;
              return putOrPrune(rec);
            }
            if ((rec.ruleTagOwners[tagName] || []).length) res.ruleOwned++; else res.absent++;
          });
        });
      });
      return chain.then(function () { return res; });
    },
    /** Every tag name with how many emails carry it: {name: count}. */
    tagCounts: function () {
      return EV.db.getAll(STORE).then(function (records) {
        var counts = {};
        records.forEach(function (r) { effectiveTags(r).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
        return counts;
      });
    },
    /** One-off conversion of stored tags that predate the name rules (capitals, spaces, ...) into the
     * valid format, merging names that collide. Idempotent. Resolves to {records, renames: {old: new}}. */
    migrateLegacyNames: function () {
      return EV.db.getAll(STORE).then(function (records) {
        var renames = {};
        var changedRecs = records.filter(function (r) { return sanitizeRecordNames(r, renames); });
        return Promise.all(changedRecs.map(function (r) { return putOrPrune(r); })).then(function () {
          return { records: changedRecs.length, renames: renames };
        });
      });
    },
    setNote: function (id, note) {
      return rawGet(id).then(function (rec) {
        rec = migrate(rec || { id: id });
        rec.note = note;
        return putOrPrune(rec);
      });
    },
    /** One-off cleanup for records left over from before putOrPrune existed. Returns the count removed. */
    pruneEmpty: function () {
      return EV.db.getAll(STORE).then(function (records) {
        var toDelete = records.filter(function (r) {
          return effectiveTags(r).length === 0 && (!r.note || !String(r.note).trim());
        });
        return Promise.all(toDelete.map(function (r) { return EV.db.delete(STORE, r.id); })).then(function () {
          return toDelete.length;
        });
      });
    },
    allTagNames: function () {
      return EV.db.getAll(STORE).then(function (records) {
        var set = {};
        records.forEach(function (r) { effectiveTags(r).forEach(function (t) { set[t] = true; }); });
        return Object.keys(set).sort();
      });
    },
    exportJson: function () {
      return EV.db.getAll(STORE).then(function (records) {
        return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), records: records.map(migrate) }, null, 2);
      });
    },
    /** Imports tags/notes from a JSON export. Names are converted to the valid format on the way in
     * (so an old export with capitals/spaces still loads). Resolves to {records, renamed}. */
    importJsonDetailed: function (jsonText) {
      var parsed = JSON.parse(jsonText);
      var records = parsed.records || parsed;
      if (!Array.isArray(records)) throw new Error('Unrecognized tag export format');
      var chain = Promise.resolve();
      var renamed = {};
      records.forEach(function (rec) {
        if (!rec || !rec.id) return;
        chain = chain.then(function () {
          return rawGet(rec.id).then(function (existing) {
            var incoming = { manualTags: (rec.manualTags || rec.tags || []).slice(), ruleTagOwners: rec.ruleTagOwners || {} };
            sanitizeRecordNames(incoming, renamed);
            var merged = migrate(existing || { id: rec.id });
            merged.manualTags = Array.from(new Set(merged.manualTags.concat(incoming.manualTags)));
            Object.keys(incoming.ruleTagOwners).forEach(function (tag) {
              var owners = merged.ruleTagOwners[tag] || (merged.ruleTagOwners[tag] = []);
              (incoming.ruleTagOwners[tag] || []).forEach(function (rid) { if (owners.indexOf(rid) === -1) owners.push(rid); });
            });
            if (rec.note && !merged.note) merged.note = rec.note;
            return putOrPrune(merged);
          });
        });
      });
      return chain.then(function () { return { records: records.length, renamed: renamed }; });
    },
    importJson: function (jsonText) {
      return EV.tags.importJsonDetailed(jsonText).then(function (r) { return r.records; });
    }
  };
})(typeof self !== 'undefined' ? self : this);
