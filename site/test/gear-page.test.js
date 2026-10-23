import { beforeEach, describe, expect, it, vi } from "vitest";
import { GearPage } from "../src/gear-page/gear-page";
import { groupData } from "../src/data/group-data";
import { api } from "../src/data/api";

const WHIP = 4151;
const GODSWORD = 11802;
const DEFENDER = 12954;
const SHARK = 385;
const ARROW = 882;
const PURGING_STAFF = 29594;
const SCORCHING_BOW = 29591;
const SYNAPSE = 29580;

function loadoutWith({ equipment = {}, inventory = {} } = {}) {
  const loadout = { equipment: new Array(28).fill(0), inventory: new Array(56).fill(0) };
  for (const [slot, [id, qty]] of Object.entries(equipment)) {
    loadout.equipment[slot * 2] = id;
    loadout.equipment[slot * 2 + 1] = qty;
  }
  for (const [index, [id, qty]] of Object.entries(inventory)) {
    loadout.inventory[index * 2] = id;
    loadout.inventory[index * 2 + 1] = qty;
  }
  return loadout;
}

function makePage({ owned, members = {} }) {
  groupData.members = new Map([
    ["Alice", {}],
    ["Bob", {}],
    ["@SHARED", {}],
  ]);
  groupData.items = Object.fromEntries(
    Object.entries(owned).map(([id, quantity]) => [id, { id: parseInt(id), name: `Item ${id}`, quantity }])
  );

  const page = new GearPage();
  page.itemSlots = {
    slots: { [WHIP]: 3, [GODSWORD]: 3, [DEFENDER]: 5, [ARROW]: 13, [PURGING_STAFF]: 3, [SCORCHING_BOW]: 3 },
    twoHanded: new Set([GODSWORD, SCORCHING_BOW]),
  };
  page.setups = [{ id: 1, name: "ToB", version: 1, members }];
  page.currentSetupId = 1;
  page.selectedMember = "Alice";
  page.dirtySetupIds = new Set();
  page.quantityInput = { value: "1" };
  page.renderLoadoutAndPicker = vi.fn();
  page.renderMembers = vi.fn();
  page.setStatus = vi.fn();
  page.markDirty = vi.fn();
  return page;
}

describe("gear page", () => {
  beforeEach(() => {
    api.exampleDataEnabled = false;
  });

  it("limits an item to what the group owns across all members", () => {
    const page = makePage({ owned: { [WHIP]: 1 }, members: { Bob: loadoutWith({ equipment: { 3: [WHIP, 1] } }) } });
    page.selection = { kind: "equipment", slot: 3 };

    expect(page.availableQuantity(WHIP, page.usedQuantities())).toBe(0);
    page.placeItem(WHIP);
    expect(page.loadoutFor("Alice")?.equipment[6] || 0).toBe(0);
  });

  it("counts the selected slot's own item as available when replacing it", () => {
    const page = makePage({ owned: { [SHARK]: 10 }, members: { Alice: loadoutWith({ inventory: { 0: [SHARK, 4] } }) } });
    page.selection = { kind: "inventory", index: 0 };

    expect(page.availableQuantity(SHARK, page.usedQuantities())).toBe(10);
    page.selection = { kind: "inventory", index: 1 };
    expect(page.availableQuantity(SHARK, page.usedQuantities())).toBe(6);
  });

  it("caps a requested quantity at what is available", () => {
    const page = makePage({ owned: { [ARROW]: 500 }, members: { Bob: loadoutWith({ equipment: { 13: [ARROW, 300] } }) } });
    page.selection = { kind: "equipment", slot: 13 };
    page.quantityInput.value = "1000";

    page.placeItem(ARROW);
    expect(page.loadoutFor("Alice").equipment.slice(26, 28)).toEqual([ARROW, 200]);
  });

  it("only allows a quantity in inventory, weapon and ammo slots", () => {
    const page = makePage({ owned: { [DEFENDER]: 5 } });
    page.selection = { kind: "equipment", slot: 5 };
    page.quantityInput.value = "3";

    page.placeItem(DEFENDER);
    expect(page.loadoutFor("Alice").equipment.slice(10, 12)).toEqual([DEFENDER, 1]);
  });

  it("removes the shield when a two-handed weapon is equipped, and vice versa", () => {
    const page = makePage({ owned: { [GODSWORD]: 1, [DEFENDER]: 1 } });
    page.selection = { kind: "equipment", slot: 5 };
    page.placeItem(DEFENDER);
    page.selection = { kind: "equipment", slot: 3 };
    page.placeItem(GODSWORD);

    const loadout = page.loadoutFor("Alice");
    expect(loadout.equipment.slice(6, 8)).toEqual([GODSWORD, 1]);
    expect(loadout.equipment.slice(10, 12)).toEqual([0, 0]);

    page.selection = { kind: "equipment", slot: 5 };
    page.placeItem(DEFENDER);
    expect(loadout.equipment.slice(6, 8)).toEqual([0, 0]);
    expect(loadout.equipment.slice(10, 12)).toEqual([DEFENDER, 1]);
  });

  it("only offers items that fit the selected equipment slot", () => {
    const page = makePage({ owned: { [WHIP]: 1, [SHARK]: 1 } });
    page.selection = { kind: "equipment", slot: 3 };
    expect(page.fitsSelection(WHIP)).toBe(true);
    expect(page.fitsSelection(SHARK)).toBe(false);
    page.selection = { kind: "inventory", index: 0 };
    expect(page.fitsSelection(SHARK)).toBe(true);
  });

  it("moves to the next empty inventory slot after placing an item", () => {
    const page = makePage({
      owned: { [SHARK]: 10 },
      members: { Alice: loadoutWith({ inventory: { 1: [SHARK, 1] } }) },
    });
    page.selection = { kind: "inventory", index: 0 };
    page.placeItem(SHARK);
    expect(page.selection).toEqual({ kind: "inventory", index: 2 });
  });

  it("saves only non-empty loadouts of current members and keeps the new version", async () => {
    const page = makePage({
      owned: {},
      members: {
        Alice: loadoutWith({ equipment: { 3: [WHIP, 1] } }),
        Bob: loadoutWith(),
        "Old Member": loadoutWith({ equipment: { 3: [WHIP, 1] } }),
      },
    });
    const update = vi.spyOn(api, "updateLoadoutSetup").mockResolvedValue({ ok: true, status: 200, data: { version: 2 } });
    page.dirtySetupIds.add(1);

    await page.saveDirtySetups();

    expect(update).toHaveBeenCalledTimes(1);
    expect(Object.keys(update.mock.calls[0][0].members)).toEqual(["Alice"]);
    expect(update.mock.calls[0][0].version).toBe(1);
    expect(page.setups[0].version).toBe(2);
  });

  it("reloads the setups when someone else saved first", async () => {
    const page = makePage({ owned: {}, members: { Alice: loadoutWith({ equipment: { 3: [WHIP, 1] } }) } });
    vi.spyOn(api, "updateLoadoutSetup").mockResolvedValue({ ok: false, status: 409, data: "conflict" });
    const reload = vi.spyOn(page, "reloadAfterConflict").mockResolvedValue("conflict");
    page.dirtySetupIds.add(1);

    await page.saveDirtySetups();

    expect(reload).toHaveBeenCalledWith(1);
    expect(page.dirtySetupIds.size).toBe(0);
  });

  it("shares one limit between a Purging staff, Scorching bow and loose synapses", () => {
    const page = makePage({
      owned: { [SCORCHING_BOW]: 1, [SYNAPSE]: 1 },
      members: { Bob: loadoutWith({ equipment: { 3: [SCORCHING_BOW, 1] } }) },
    });
    page.selection = { kind: "equipment", slot: 3 };

    // 2 synapse items owned, Bob's bow uses 1, so Alice can still have a staff the group doesn't hold
    expect(page.availableQuantity(PURGING_STAFF, page.usedQuantities())).toBe(1);
    page.placeItem(PURGING_STAFF);
    expect(page.loadoutFor("Alice").equipment.slice(6, 8)).toEqual([PURGING_STAFF, 1]);
    expect(page.availableQuantity(SCORCHING_BOW, page.usedQuantities())).toBe(1); // counting the staff in this slot
    page.selection = { kind: "inventory", index: 0 };
    expect(page.availableQuantity(SCORCHING_BOW, page.usedQuantities())).toBe(0);
  });

  it("transforms a Purging staff into a Scorching bow, removing the shield for the two-handed bow", () => {
    const page = makePage({
      owned: { [PURGING_STAFF]: 1, [DEFENDER]: 1 },
      members: { Alice: loadoutWith({ equipment: { 3: [PURGING_STAFF, 1], 5: [DEFENDER, 1] } }) },
    });
    page.selection = { kind: "equipment", slot: 3 };

    expect(page.transformOptions(PURGING_STAFF)).toEqual([SCORCHING_BOW]);
    expect(page.transformOptions(WHIP)).toEqual([]);
    page.transformSlot(SCORCHING_BOW);

    const loadout = page.loadoutFor("Alice");
    expect(loadout.equipment.slice(6, 8)).toEqual([SCORCHING_BOW, 1]);
    expect(loadout.equipment.slice(10, 12)).toEqual([0, 0]);
    // Still within the group's single synapse item
    expect(page.usedQuantity(SCORCHING_BOW, page.usedQuantities())).toBe(page.ownedQuantity(SCORCHING_BOW));
  });

  it("does not transform into an item outside the slot item's pool", () => {
    const page = makePage({ owned: { [WHIP]: 1 }, members: { Alice: loadoutWith({ equipment: { 3: [WHIP, 1] } }) } });
    page.selection = { kind: "equipment", slot: 3 };
    page.transformSlot(SCORCHING_BOW);
    expect(page.loadoutFor("Alice").equipment.slice(6, 8)).toEqual([WHIP, 1]);
  });

  describe("dragging", () => {
    const HELM = 10828;
    const at = (member, kind, n) => (kind === "equipment" ? { member, kind, slot: n } : { member, kind, index: n });
    const slot = (page, member, kind, n) => {
      const loadout = page.loadoutFor(member);
      const array = kind === "equipment" ? loadout.equipment : loadout.inventory;
      return array.slice(n * 2, n * 2 + 2);
    };
    const dragPage = (members) => {
      const page = makePage({ owned: {}, members });
      page.itemSlots.slots[HELM] = 0;
      return page;
    };

    it("moves an item from the inventory into the slot it fits", () => {
      const page = dragPage({ Alice: loadoutWith({ inventory: { 4: [WHIP, 1] } }) });
      expect(page.moveItem(at("Alice", "inventory", 4), at("Alice", "equipment", 3))).toBe(true);
      expect(slot(page, "Alice", "equipment", 3)).toEqual([WHIP, 1]);
      expect(slot(page, "Alice", "inventory", 4)).toEqual([0, 0]);
    });

    it("refuses a slot the item doesn't fit, without changing anything", () => {
      const page = dragPage({ Alice: loadoutWith({ inventory: { 0: [SHARK, 5] } }) });
      expect(page.moveItem(at("Alice", "inventory", 0), at("Alice", "equipment", 0), true)).toBe(false);
      expect(page.moveItem(at("Alice", "inventory", 0), at("Alice", "equipment", 0))).toBe(false);
      expect(slot(page, "Alice", "inventory", 0)).toEqual([SHARK, 5]);
    });

    it("swaps items between members", () => {
      const page = dragPage({
        Alice: loadoutWith({ equipment: { 3: [WHIP, 1] } }),
        Bob: loadoutWith({ equipment: { 3: [PURGING_STAFF, 1] } }),
      });
      expect(page.moveItem(at("Alice", "equipment", 3), at("Bob", "equipment", 3))).toBe(true);
      expect(slot(page, "Alice", "equipment", 3)).toEqual([PURGING_STAFF, 1]);
      expect(slot(page, "Bob", "equipment", 3)).toEqual([WHIP, 1]);
    });

    it("gives a member without a loadout one when an item is dropped on them", () => {
      const page = dragPage({ Alice: loadoutWith({ inventory: { 0: [SHARK, 3] } }) });
      expect(page.moveItem(at("Alice", "inventory", 0), at("Bob", "inventory", 27))).toBe(true);
      expect(slot(page, "Bob", "inventory", 27)).toEqual([SHARK, 3]);
    });

    it("refuses a swap when the other item can't go where the dragged one came from", () => {
      const page = dragPage({ Alice: loadoutWith({ equipment: { 3: [WHIP, 1] }, inventory: { 0: [SHARK, 1] } }) });
      expect(page.moveItem(at("Alice", "equipment", 3), at("Alice", "inventory", 0))).toBe(false);
      expect(slot(page, "Alice", "equipment", 3)).toEqual([WHIP, 1]);
    });

    it("stacks the same item where quantities are allowed", () => {
      const page = dragPage({ Alice: loadoutWith({ inventory: { 0: [SHARK, 2], 1: [SHARK, 3] } }) });
      expect(page.moveItem(at("Alice", "inventory", 0), at("Alice", "inventory", 1))).toBe(true);
      expect(slot(page, "Alice", "inventory", 1)).toEqual([SHARK, 5]);
      expect(slot(page, "Alice", "inventory", 0)).toEqual([0, 0]);
    });

    it("moves one of a stack onto a single-item slot and leaves the rest", () => {
      const page = dragPage({ Alice: loadoutWith({ inventory: { 0: [HELM, 3] } }) });
      expect(page.moveItem(at("Alice", "inventory", 0), at("Alice", "equipment", 0))).toBe(true);
      expect(slot(page, "Alice", "equipment", 0)).toEqual([HELM, 1]);
      expect(slot(page, "Alice", "inventory", 0)).toEqual([HELM, 2]);
    });

    it("puts the shield where a two-handed weapon was dragged from", () => {
      const page = dragPage({
        Alice: loadoutWith({ equipment: { 5: [DEFENDER, 1] }, inventory: { 6: [GODSWORD, 1] } }),
      });
      expect(page.moveItem(at("Alice", "inventory", 6), at("Alice", "equipment", 3))).toBe(true);
      expect(slot(page, "Alice", "equipment", 3)).toEqual([GODSWORD, 1]);
      expect(slot(page, "Alice", "equipment", 5)).toEqual([0, 0]);
      expect(slot(page, "Alice", "inventory", 6)).toEqual([DEFENDER, 1]);
    });
  });

  it("does not save until Save is clicked", async () => {
    vi.useFakeTimers();
    const page = makePage({ owned: { [WHIP]: 1 } });
    delete page.markDirty; // use the real one
    const update = vi.spyOn(api, "updateLoadoutSetup").mockResolvedValue({ ok: true, status: 200, data: { version: 2 } });
    page.selection = { kind: "equipment", slot: 3 };

    page.placeItem(WHIP);
    await vi.advanceTimersByTimeAsync(10000);
    expect(update).not.toHaveBeenCalled();
    expect(page.dirtySetupIds.has(1)).toBe(true);

    await page.saveDirtySetups();
    expect(update).toHaveBeenCalledTimes(1);
    expect(page.dirtySetupIds.size).toBe(0);
  });

  it("keeps unsaved edits to other setups when one setup conflicts", async () => {
    const page = makePage({ owned: {} });
    page.reloadAfterConflict = GearPage.prototype.reloadAfterConflict;
    page.renderAll = vi.fn();
    Object.defineProperty(page, "isConnected", { value: true });
    page.setups = [
      { id: 1, name: "ToB", version: 1, members: { Alice: loadoutWith({ equipment: { 3: [WHIP, 1] } }) } },
      { id: 2, name: "CoX", version: 5, members: { Alice: loadoutWith({ equipment: { 3: [GODSWORD, 1] } }) } },
    ];
    const serverToB = { id: 1, name: "ToB (theirs)", version: 3, members: {} };
    vi.spyOn(api, "getLoadouts").mockResolvedValue({ ok: true, status: 200, data: [serverToB, { id: 2, name: "CoX", version: 5, members: {} }] });
    vi.spyOn(api, "updateLoadoutSetup").mockImplementation(async (setup) =>
      setup.id === 1 ? { ok: false, status: 409, data: "conflict" } : { ok: true, status: 200, data: { version: 6 } }
    );
    page.dirtySetupIds = new Set([1, 2]);

    await page.saveDirtySetups();

    expect(page.setups[0]).toBe(serverToB);
    expect(page.setups[1].members.Alice.equipment[6]).toBe(GODSWORD);
    expect(page.setups[1].version).toBe(6);
    expect(page.setStatus).toHaveBeenLastCalledWith(expect.stringContaining("changed by someone else"), true);
  });

  it("keeps a setup marked unsaved when saving it fails", async () => {
    const page = makePage({ owned: {}, members: { Alice: loadoutWith({ equipment: { 3: [WHIP, 1] } }) } });
    vi.spyOn(api, "updateLoadoutSetup").mockRejectedValue(new Error("network down"));
    page.dirtySetupIds.add(1);

    await page.saveDirtySetups();

    expect(page.dirtySetupIds.has(1)).toBe(true);
    expect(page.setStatus).toHaveBeenLastCalledWith(expect.stringContaining("network down"), true);
  });
});
