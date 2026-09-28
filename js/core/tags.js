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
    addTag: function (id, tag, source) {
      tag = tag.trim();
      if (!tag) return Promise.resolve();
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
     * itself: if a still-enabled rule asserts this tag, its next run simply re-applies it, since a
     * tag being removed here isn't the same thing as the rule that keeps re-creating it being turned
     * off -- disable or delete that rule too for the removal to actually stick. Returns the number of
     * emails the tag was removed from. */
    removeTagEverywhere: function (tagName) {
      return EV.db.getAll(STORE).then(function (records) {
        var affected = records.filter(function (r) { return effectiveTags(r).indexOf(tagName) !== -1; });
        return Promise.all(affected.map(function (r) {
          var rec = migrate(r);
          rec.manualTags = rec.manualTags.filter(function (t) { return t !== tagName; });
          delete rec.ruleTagOwners[tagName];
          return putOrPrune(rec);
        })).then(function () { return affected.length; });
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
    importJson: function (jsonText) {
      var parsed = JSON.parse(jsonText);
      var records = parsed.records || parsed;
      if (!Array.isArray(records)) throw new Error('Unrecognized tag export format');
      var chain = Promise.resolve();
      records.forEach(function (rec) {
        if (!rec || !rec.id) return;
        chain = chain.then(function () {
          return rawGet(rec.id).then(function (existing) {
            var merged = migrate(existing || { id: rec.id });
            var incomingManual = rec.manualTags || rec.tags || [];
            merged.manualTags = Array.from(new Set(merged.manualTags.concat(incomingManual)));
            if (rec.ruleTagOwners) {
              Object.keys(rec.ruleTagOwners).forEach(function (tag) {
                var owners = merged.ruleTagOwners[tag] || (merged.ruleTagOwners[tag] = []);
                (rec.ruleTagOwners[tag] || []).forEach(function (rid) { if (owners.indexOf(rid) === -1) owners.push(rid); });
              });
            }
            if (rec.note && !merged.note) merged.note = rec.note;
            return putOrPrune(merged);
          });
        });
      });
      return chain.then(function () { return records.length; });
    }
  };
})(typeof self !== 'undefined' ? self : this);
