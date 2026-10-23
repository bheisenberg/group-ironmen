import { Item } from "./item";
import { SkillName } from "./skill";
import { Quest } from "./quest";
import { utility } from "../utility";
import { SkillGraph } from "../skill-graph/skill-graph";
import { GroupData } from "./group-data";
import { AchievementDiary } from "./diaries";

const clone = (value) => JSON.parse(JSON.stringify(value));

class ExampleData {
  enable() {
    this.disable();
    const loadId = this.loadId;
    // A local snapshot of a real group's data (from get-group-data) replaces the random sample when
    // present. It is not committed, so the deployed demo always uses the random sample.
    fetch("/data/sample-snapshot.json")
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((snapshot) => {
        if (loadId !== this.loadId) return; // disabled while loading
        this.snapshot = Array.isArray(snapshot) ? snapshot : null;
        this.reset();
        if (!this.snapshot) this.startRandomUpdates();
      });
  }

  startRandomUpdates() {
    this.intervals = [
      utility.callOnInterval(this.doHealthUpdate.bind(this), 3000),
      utility.callOnInterval(this.doXpDrop.bind(this), 2000),
      utility.callOnInterval(() => {
        let plane = this.members["Zezima"].coordinates[2];
        plane += 1;
        if (plane > 3) plane = 0;
        this.members["Zezima"].coordinates = [
          this.members["Zezima"].coordinates[0] + 1,
          this.members["Zezima"].coordinates[1],
          plane,
        ];
      }, 1000),
    ];
  }

  disable() {
    this.loadId = (this.loadId || 0) + 1;
    this.members = undefined;
    if (this.intervals) {
      for (const interval of this.intervals) {
        clearInterval(interval);
      }

      this.intervals = [];
    }
  }

  reset() {
    if (this.snapshot) {
      this.members = Object.fromEntries(this.snapshot.map(({ name, ...data }) => [name, data]));
      return;
    }

    this.members = {
      Zezima: {
        quests: Quest.randomQuestStates(),
        bank: [995, Math.floor(Math.random() * 25000000)],
        stats: [99, 99, 99, 99, 100, 100, 330],
        skills: Object.values(SkillName).map(() => Math.floor(Math.random() * 14000000)),
        equipment: Item.randomItems(14, 1),
        inventory: Item.randomItems(28),
        coordinates: [3029, 3000, 0],
        last_updated: "2022-01-23T01:34:06.104Z",
        diary_vars: AchievementDiary.randomDiaries(),
        potion_storage: this.randomPotionStorage(),
      },
      "group alt two": {
        rune_pouch: [563, 1922, 561, 5, 554, 15194],
        quests: Quest.randomQuestStates(),
        coordinates: [3029, 3000, 0],
        // coordinates: [3129, 3100, 0],
        stats: [55, 93, 13, 70, 75, 100, 330],
        skills: Object.values(SkillName).map(() => Math.floor(Math.random() * 14000000)),
        bank: [995, Math.floor(Math.random() * 5000000)],
        diary_vars: AchievementDiary.randomDiaries(),
        potion_storage: this.randomPotionStorage(),
        inventory: [
          26382,
          1,
          26384,
          1,
          26386,
          1,
          12791,
          1,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          6685,
          1,
          6685,
          1,
          6685,
          1,
          6685,
          1,
          6685,
          1,
          6685,
          1,
          6685,
          1,
          6685,
          1,
          6685,
          1,
          995,
          Math.floor(Math.random() * 5000000),
        ],
        equipment: [26382, 1, 0, 0, 0, 0, 0, 0, 26384, 1, 0, 0, 0, 0, 26386, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      "Bank alt": {
        bank: [995, Math.floor(Math.random() * 5000000), ...Item.randomItems(500)],
        skills: Object.values(SkillName).map(() => Math.floor(Math.random() * 14000000)),
        stats: [7, 10, 10, 10, 100, 100, 309],
        equipment: Item.randomItems(14, 1),
        // coordinates: [3029, 3000, 0],
        coordinates: [3103, 3025, 0],
        quests: Quest.randomQuestStates(),
        diary_vars: AchievementDiary.randomDiaries(),
        potion_storage: this.randomPotionStorage(),
        interacting: {
          last_updated: "2050-01-01T00:00:00.000Z",
          name: "Goblin",
          ratio: 25,
          scale: 30,
          location: {
            x: 3104,
            y: 3025,
            plane: 0,
          },
        },
      },
      "@SHARED": {
        bank: [995, 1000000],
      },
    };
  }

  randomPotionStorage() {
    const potionIds = [2428, 113, 2430, 2432, 2434, 2444, 2452, 3008, 3032];
    const count = Math.floor(Math.random() * 5) + 1;
    const result = [];
    const used = new Set();
    for (let i = 0; i < count; ++i) {
      let id;
      do {
        id = potionIds[Math.floor(Math.random() * potionIds.length)];
      } while (used.has(id));
      used.add(id);
      result.push(id, Math.floor(Math.random() * 100) + 1);
    }
    return result;
  }

  getGroupData() {
    if (!this.members) return [];
    const groupData = Object.entries(this.members).map(([name, data]) => {
      return { name, ...data };
    });
    if (this.snapshot) {
      // The snapshot is static, so later polls only need to keep the members present
      this.members = Object.fromEntries(Object.keys(this.members).map((name) => [name, {}]));
      return groupData;
    }
    this.members = {
      "group alt two": {
        skills: this.members["group alt two"].skills,
      },
      Zezima: {
        coordinates: this.members["Zezima"].coordinates,
      },
      "Bank alt": {},
      "@SHARED": {},
    };
    return groupData;
  }

  doXpDrop() {
    this.members["group alt two"].skills[0] += 50;
  }

  doHealthUpdate() {
    this.members["group alt two"].stats = [Math.floor(Math.max(1, Math.random() * 93)), 93, 13, 70, 75, 100, 330];
  }

  getSkillData(period, groupData) {
    const dates = SkillGraph.datesForPeriod(period);
    const result = [];
    const skillNames = Object.values(SkillName);
    skillNames.sort((a, b) => a.localeCompare(b));

    for (const member of groupData.members.values()) {
      if (!member.skills) continue;
      const skillData = [];
      let s = skillNames.map((skillName) => member.skills[skillName].xp);

      for (const date of dates) {
        skillData.push({
          time: date.toISOString(),
          data: s,
        });
        s = s.map((x) => (Math.random() > 0.9 ? Math.round(x + Math.random() * 10000) : x));
      }

      const transformed = GroupData.transformSkillsFromStorage(s);
      for (const [skillName, xp] of Object.entries(transformed)) {
        member.skills[skillName].xp = xp;
      }

      if (this.members[member.name].skills) {
        this.members[member.name].skills = s;
      }

      result.push({
        name: member.name,
        skill_data: skillData,
      });
    }

    return result;
  }

  getCollectionLog() {
    return {};
  }

  getMemberOrder() {
    return clone(this.memberOrder || []);
  }

  setMemberOrder(memberNames) {
    this.memberOrder = clone(memberNames);
    return clone(this.memberOrder);
  }

  // In-memory stand-in for the loadouts API, mirroring its version checks
  getLoadouts() {
    return clone(this.loadoutSetups || []);
  }

  createLoadoutSetup(name) {
    if (!this.loadoutSetups) this.loadoutSetups = [];
    const setup = { id: (this.nextLoadoutSetupId = (this.nextLoadoutSetupId || 0) + 1), name, version: 1, members: {} };
    this.loadoutSetups.push(setup);
    return clone(setup);
  }

  updateLoadoutSetup({ id, name, version, members }) {
    const setup = this.loadoutSetups?.find((x) => x.id === id);
    if (!setup) return { ok: false, status: 404, data: "Loadout setup not found" };
    if (setup.version !== version) return { ok: false, status: 409, data: "Loadout setup was changed" };
    Object.assign(setup, { name, version: version + 1, members: clone(members) });
    return { ok: true, status: 200, data: clone(setup) };
  }

  deleteLoadoutSetup(id) {
    const before = this.loadoutSetups?.length || 0;
    this.loadoutSetups = (this.loadoutSetups || []).filter((x) => x.id !== id);
    return before === this.loadoutSetups.length ? { ok: false, status: 404 } : { ok: true, status: 200 };
  }
}

const exampleData = new ExampleData();

export { exampleData };
