import { BaseElement } from "../base-element/base-element";
import { api } from "../data/api";
import { groupData } from "../data/group-data";
import { pubsub } from "../data/pubsub";
import { Item } from "../data/item";
import { utility } from "../utility";
import { confirmDialogManager } from "../confirm-dialog/confirm-dialog-manager";

// Slot numbers are the game's equipment container indexes, the same ones player-equipment and
// item_slots.json use. Class names reuse player-equipment's slot layout.
const EQUIPMENT_SLOTS = [
  { slot: 0, name: "Head", className: "equipment-head", emptyImage: "156-0.png" },
  { slot: 1, name: "Cape", className: "equipment-cape", emptyImage: "157-0.png" },
  { slot: 2, name: "Neck", className: "equipment-neck", emptyImage: "158-0.png" },
  { slot: 13, name: "Ammo", className: "equipment-ammo", emptyImage: "166-0.png" },
  { slot: 3, name: "Weapon", className: "equipment-weapon", emptyImage: "159-0.png" },
  { slot: 4, name: "Body", className: "equipment-torso", emptyImage: "161-0.png" },
  { slot: 5, name: "Shield", className: "equipment-shield", emptyImage: "162-0.png" },
  { slot: 7, name: "Legs", className: "equipment-legs", emptyImage: "163-0.png" },
  { slot: 9, name: "Gloves", className: "equipment-gloves", emptyImage: "164-0.png" },
  { slot: 10, name: "Boots", className: "equipment-boots", emptyImage: "165-0.png" },
  { slot: 12, name: "Ring", className: "equipment-ring", emptyImage: "160-0.png" },
];
const WEAPON_SLOT = 3;
const SHIELD_SLOT = 5;
const AMMO_SLOT = 13;
const EQUIPMENT_SIZE = 14;
const INVENTORY_SIZE = 28;
const MAX_PICKER_RESULTS = 120;

// Items that are really one item in different forms. They share a single limit, and a setup can
// transform one form into another from the right-click menu. The Purging staff and Scorching bow
// are both made from a Tormented synapse and can be turned back into one, and a loose synapse can
// become either, so it counts toward the same limit.
const ITEM_POOLS = [
  {
    name: "Tormented synapse",
    forms: [29594 /* Purging staff */, 29591 /* Scorching bow */],
    alsoCounts: [29580 /* Tormented synapse */],
  },
];
const POOL_BY_ITEM = new Map(
  ITEM_POOLS.flatMap((pool) => [...pool.forms, ...pool.alsoCounts].map((itemId) => [itemId, pool]))
);

let itemSlotsPromise;
function loadItemSlots() {
  if (!itemSlotsPromise) {
    const getJson = (url) => fetch(url).then((response) => response.json());
    itemSlotsPromise = Promise.all([getJson("/data/item_slots.json"), getJson("/data/item_untradeable.json")]).then(
      ([{ slots, twoHanded }, untradeable]) => ({ slots, twoHanded: new Set(twoHanded), untradeable: new Set(untradeable) })
    );
    itemSlotsPromise.catch(() => (itemSlotsPromise = undefined));
  }
  return itemSlotsPromise;
}

function emptyLoadout() {
  return { equipment: new Array(EQUIPMENT_SIZE * 2).fill(0), inventory: new Array(INVENTORY_SIZE * 2).fill(0) };
}

function isEmptyLoadout(loadout) {
  return loadout.equipment.every((x) => x === 0) && loadout.inventory.every((x) => x === 0);
}

export class GearPage extends BaseElement {
  constructor() {
    super();
  }

  html() {
    return `{{gear-page.html}}`;
  }

  async connectedCallback() {
    super.connectedCallback();
    this.render();
    this.setupSelect = this.querySelector(".gear-page__setup-select");
    this.setupNameInput = this.querySelector(".gear-page__setup-name");
    this.statusEl = this.querySelector(".gear-page__status");
    this.membersEl = this.querySelector(".gear-page__members");
    this.equipmentEl = this.querySelector(".gear-page__equipment");
    this.inventoryEl = this.querySelector(".gear-page__inventory-grid");
    this.pickerHeadEl = this.querySelector(".gear-page__picker-head");
    this.pickerListEl = this.querySelector(".gear-page__picker-list");
    this.searchElement = this.querySelector(".gear-page__search");
    this.quantityLabel = this.querySelector(".gear-page__quantity-label");
    this.quantityInput = this.querySelector(".gear-page__quantity");
    this.warningsEl = this.querySelector(".gear-page__warnings");
    this.overviewEl = this.querySelector(".gear-page__overview");
    this.saveButton = this.querySelector('[data-action="save"]');
    this.discardButton = this.querySelector('[data-action="discard"]');

    // The route reuses this element, so unsaved edits survive leaving the page and coming back.
    // Start over only on first load or when a different group is logged in.
    const keepUnsaved = this.dirtySetupIds?.size > 0 && this.stateGroupName === api.groupName;
    if (!keepUnsaved) {
      this.setups = [];
      this.currentSetupId = null;
      this.selectedMember = null;
      // "overview" shows every member side by side, "edit" shows just the selected member's loadout
      this.view = "overview";
      this.dirtySetupIds = new Set();
    }
    this.stateGroupName = api.groupName;
    // { kind: "equipment", slot } or { kind: "inventory", index }
    this.selection = null;
    this.saving = false;

    this.eventListener(this, "click", this.handleClick.bind(this));
    this.eventListener(this, "contextmenu", this.handleContextMenu.bind(this), { passive: false });
    this.eventListener(this, "dragstart", this.handleDragStart.bind(this));
    this.eventListener(this, "dragover", this.handleDragOver.bind(this), { passive: false });
    this.eventListener(this, "drop", this.handleDrop.bind(this), { passive: false });
    this.eventListener(this, "dragend", this.handleDragEnd.bind(this));
    this.eventListener(this.setupSelect, "change", this.handleSetupChange.bind(this));
    this.eventListener(this.setupNameInput, "input", this.handleSetupNameInput.bind(this));
    this.eventListener(this.searchElement, "input", () => this.renderPicker());
    this.eventListener(window, "beforeunload", this.handleBeforeUnload.bind(this), { passive: false });
    this.contextMenu = this.querySelector(".gear-page__context-menu");
    this.eventListener(document, "keydown", this.handleKeyDown.bind(this));
    this.eventListener(window, "scroll", () => this.closeContextMenu(), { capture: true });
    this.eventListener(document, "click", (event) => !this.contains(event.target) && this.closeContextMenu());

    this.setStatus("Loading...");
    // Opening /group/gear directly mounts this page before the app has logged in, so wait for
    // the first group data load (resolves immediately if it already happened)
    await pubsub.waitUntilNextEvent("get-group-data");
    if (!this.isConnected) return;
    try {
      [this.itemSlots] = await Promise.all([loadItemSlots(), keepUnsaved ? null : this.loadSetups()]);
    } catch (error) {
      this.setStatus(`Failed to load gear setups: ${error}`, true);
      return;
    }
    if (!this.isConnected) return;

    this.subscribe("members-updated", this.handleMembersUpdated.bind(this));
    this.subscribe("items-updated", () => this.renderLoadoutAndPicker());
    this.setStatus("");
    this.updateSaveState();
    this.renderAll();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  // Ask before closing or reloading the tab with unsaved changes
  handleBeforeUnload(event) {
    if (this.dirtySetupIds.size === 0) return;
    event.preventDefault();
    event.returnValue = "";
  }

  get currentSetup() {
    return this.setups.find((setup) => setup.id === this.currentSetupId) || null;
  }

  get memberNames() {
    return [...groupData.members.keys()].filter((name) => name !== "@SHARED");
  }

  async loadSetups() {
    const result = await api.getLoadouts();
    if (!result.ok) throw new Error(result.data || result.status);
    this.setups = result.data;
    if (!this.currentSetup) this.currentSetupId = this.setups[0]?.id ?? null;
  }

  handleMembersUpdated() {
    if (!this.memberNames.includes(this.selectedMember)) {
      this.selectedMember = this.memberNames[0] || null;
      this.selection = null;
    }
    this.renderMembers();
    this.renderLoadoutAndPicker();
  }

  // ---- Loadout data ----

  loadoutFor(memberName, create = false) {
    const setup = this.currentSetup;
    if (!setup || !memberName) return null;
    if (!setup.members[memberName] && create) setup.members[memberName] = emptyLoadout();
    return setup.members[memberName] || null;
  }

  // [itemId, quantity] in a member's slot
  slotContents(location) {
    const loadout = location && this.loadoutFor(location.member);
    if (!loadout) return [0, 0];
    const [array, index] = this.slotLocation(loadout, location);
    return [array[index], array[index + 1]];
  }

  get selectedLocation() {
    return this.selection ? { member: this.selectedMember, ...this.selection } : null;
  }

  selectedSlotContents() {
    return this.slotContents(this.selectedLocation);
  }

  slotLocation(loadout, selection) {
    return selection.kind === "equipment"
      ? [loadout.equipment, selection.slot * 2]
      : [loadout.inventory, selection.index * 2];
  }

  // How many of each item the current setup uses, across every member
  usedQuantities() {
    const used = new Map();
    for (const loadout of Object.values(this.currentSetup?.members || {})) {
      for (const array of [loadout.equipment, loadout.inventory]) {
        for (let i = 0; i < array.length; i += 2) {
          if (array[i] > 0) used.set(array[i], (used.get(array[i]) || 0) + array[i + 1]);
        }
      }
    }
    return used;
  }

  // The item ids that share an item's limit: its whole pool, or just itself
  limitIds(itemId) {
    const pool = POOL_BY_ITEM.get(itemId);
    return pool ? [...pool.forms, ...pool.alsoCounts] : [itemId];
  }

  // Untradeable items can't be passed between members (not even through group storage), so only
  // the member holding one can use it. Synapse weapons are untradeable but are left out: they
  // can be dismantled into a tradeable synapse and made again.
  isOwnerOnly(itemId) {
    return !!this.itemSlots?.untradeable?.has(itemId) && !POOL_BY_ITEM.has(itemId);
  }

  // With a member, an owner-only item counts just what that member holds and uses
  ownedQuantity(itemId, member = null) {
    if (member && this.isOwnerOnly(itemId)) return groupData.items[itemId]?.quantities?.[member] || 0;
    return this.limitIds(itemId).reduce((total, id) => total + (groupData.items[id]?.quantity || 0), 0);
  }

  usedQuantity(itemId, used, member = null) {
    if (member && this.isOwnerOnly(itemId)) return this.memberUsedQuantity(itemId, member);
    return this.limitIds(itemId).reduce((total, id) => total + (used.get(id) || 0), 0);
  }

  memberUsedQuantity(itemId, member) {
    const loadout = this.loadoutFor(member);
    let total = 0;
    for (const array of loadout ? [loadout.equipment, loadout.inventory] : []) {
      for (let i = 0; i < array.length; i += 2) {
        if (array[i] === itemId) total += array[i + 1];
      }
    }
    return total;
  }

  // Members holding an owner-only item
  owners(itemId) {
    return this.memberNames.filter((member) => this.ownedQuantity(itemId, member) > 0);
  }

  // How many more of an item can go in a slot (the selected one by default), counting what's
  // already in it. With no slot, an owner-only item counts what each owner has left.
  availableQuantity(itemId, used, location = this.selectedLocation) {
    if (!location && this.isOwnerOnly(itemId)) {
      return this.owners(itemId).reduce(
        (total, member) => total + Math.max(0, this.ownedQuantity(itemId, member) - this.memberUsedQuantity(itemId, member)),
        0
      );
    }
    const member = location?.member;
    const [slotItemId, slotQuantity] = this.slotContents(location);
    const freed = this.limitIds(itemId).includes(slotItemId) ? slotQuantity : 0;
    return this.ownedQuantity(itemId, member) - this.usedQuantity(itemId, used, member) + freed;
  }

  // Whether a member can take an owner-only item from another member's loadout
  canGive(itemId, quantity, fromMember, toMember) {
    if (fromMember === toMember || !this.isOwnerOnly(itemId)) return true;
    return this.ownedQuantity(itemId, toMember) - this.memberUsedQuantity(itemId, toMember) >= quantity;
  }

  transformOptions(itemId) {
    return POOL_BY_ITEM.get(itemId)?.forms.filter((form) => form !== itemId) || [];
  }

  // A location is a selection ({ kind, slot } or { kind, index }), optionally with a member
  allowsQuantity(location) {
    return location.kind === "inventory" || [WEAPON_SLOT, AMMO_SLOT].includes(location.slot);
  }

  fitsLocation(itemId, location) {
    return location.kind === "inventory" || this.itemSlots.slots[itemId] === location.slot;
  }

  selectionAllowsQuantity() {
    return !!this.selection && this.allowsQuantity(this.selection);
  }

  fitsSelection(itemId) {
    return this.fitsLocation(itemId, this.selection);
  }

  // Moves the item at one member's slot to another slot, possibly another member's. Dropping
  // onto the same item stacks them where quantities are allowed, onto a different item swaps
  // the two, and a stack dropped on a single-item slot like Head moves just one. Returns
  // whether the move is allowed; with dryRun nothing is changed.
  moveItem(from, to, dryRun = false) {
    if (from.member === to.member && from.kind === to.kind && from.slot === to.slot && from.index === to.index) {
      return false;
    }
    const fromLoadout = this.loadoutFor(from.member);
    if (!fromLoadout || !this.memberNames.includes(to.member)) return false;
    const [fromArray, fromIndex] = this.slotLocation(fromLoadout, from);
    const [itemId, quantity] = [fromArray[fromIndex], fromArray[fromIndex + 1]];
    if (!itemId || !this.fitsLocation(itemId, to)) return false;

    const toLoadout = this.loadoutFor(to.member, !dryRun) || emptyLoadout();
    const [toArray, toIndex] = this.slotLocation(toLoadout, to);
    const [targetId, targetQuantity] = [toArray[toIndex], toArray[toIndex + 1]];

    let apply;
    let movedQuantity = quantity;
    let returned = targetId && targetId !== itemId;
    if (targetId === itemId && this.allowsQuantity(to)) {
      returned = false;
      apply = () => {
        toArray[toIndex + 1] += quantity;
        fromArray[fromIndex] = fromArray[fromIndex + 1] = 0;
      };
    } else if (quantity > 1 && !this.allowsQuantity(to)) {
      if (targetId) return false;
      movedQuantity = 1;
      apply = () => {
        toArray[toIndex] = itemId;
        toArray[toIndex + 1] = 1;
        fromArray[fromIndex + 1] = quantity - 1;
      };
    } else {
      if (targetId && !this.fitsLocation(targetId, from)) return false;
      if (targetId && targetQuantity > 1 && !this.allowsQuantity(from)) return false;
      apply = () => {
        toArray[toIndex] = itemId;
        toArray[toIndex + 1] = quantity;
        fromArray[fromIndex] = targetId;
        fromArray[fromIndex + 1] = targetId ? targetQuantity : 0;
      };
    }
    if (!this.canGive(itemId, movedQuantity, from.member, to.member)) return false;
    if (returned && !this.canGive(targetId, targetQuantity, to.member, from.member)) return false;
    if (dryRun) return true;

    apply();
    if (to.kind === "equipment") this.resolveTwoHanded(toLoadout, to.slot, itemId, from, fromArray, fromIndex);
    if (from.kind === "equipment" && fromArray[fromIndex]) {
      this.applyTwoHandedRule(fromLoadout, from.slot, fromArray[fromIndex]);
    }
    return true;
  }

  // A two-handed weapon and a shield can't be worn together. Like unequipping in game, the one
  // that has to come off goes where the dragged item came from if that slot is now free and it
  // fits there, otherwise it's removed from the loadout.
  resolveTwoHanded(loadout, slot, itemId, from, fromArray, fromIndex) {
    const twoHanded = this.itemSlots.twoHanded;
    let conflictSlot = null;
    if (slot === WEAPON_SLOT && twoHanded.has(itemId)) conflictSlot = SHIELD_SLOT;
    if (slot === SHIELD_SLOT && twoHanded.has(loadout.equipment[WEAPON_SLOT * 2])) conflictSlot = WEAPON_SLOT;
    if (conflictSlot === null) return;

    const [displacedId, displacedQuantity] = loadout.equipment.slice(conflictSlot * 2, conflictSlot * 2 + 2);
    if (!displacedId) return;
    this.setSlot(loadout, { kind: "equipment", slot: conflictSlot }, 0, 0);
    const fits =
      fromArray[fromIndex] === 0 &&
      this.fitsLocation(displacedId, from) &&
      (displacedQuantity === 1 || this.allowsQuantity(from));
    if (fits) {
      fromArray[fromIndex] = displacedId;
      fromArray[fromIndex + 1] = displacedQuantity;
    }
  }

  setSlot(loadout, selection, itemId, quantity) {
    const [array, index] = this.slotLocation(loadout, selection);
    array[index] = itemId;
    array[index + 1] = itemId ? quantity : 0;
  }

  placeItem(itemId) {
    const loadout = this.loadoutFor(this.selectedMember, true);
    if (!loadout || !this.selection) return;
    const available = this.availableQuantity(itemId, this.usedQuantities());
    if (available <= 0) return;
    const requested = this.selectionAllowsQuantity() ? parseInt(this.quantityInput.value) || 1 : 1;
    const quantity = Math.max(1, Math.min(requested, available));
    this.setSlot(loadout, this.selection, itemId, quantity);

    if (this.selection.kind === "equipment") {
      this.applyTwoHandedRule(loadout, this.selection.slot, itemId);
    } else {
      // Move on to the next empty inventory slot so filling an inventory is quick
      for (let i = 1; i <= INVENTORY_SIZE; ++i) {
        const index = (this.selection.index + i) % INVENTORY_SIZE;
        if (loadout.inventory[index * 2] === 0) {
          this.selection = { kind: "inventory", index };
          break;
        }
      }
    }

    this.changed();
  }

  // Places an item dragged from the picker into any member's slot, replacing what's there like
  // picking does. Returns whether it's allowed; with dryRun nothing is changed.
  placeItemAt(location, itemId, dryRun = false) {
    if (!this.memberNames.includes(location.member) || !this.fitsLocation(itemId, location)) return false;
    const available = this.availableQuantity(itemId, this.usedQuantities(), location);
    if (available <= 0) return false;
    if (dryRun) return true;

    const loadout = this.loadoutFor(location.member, true);
    const requested = this.allowsQuantity(location) ? parseInt(this.quantityInput.value) || 1 : 1;
    this.setSlot(loadout, location, itemId, Math.max(1, Math.min(requested, available)));
    if (location.kind === "equipment") this.applyTwoHandedRule(loadout, location.slot, itemId);
    return true;
  }

  // A two-handed weapon and a shield can't be worn together
  applyTwoHandedRule(loadout, slot, itemId) {
    const twoHanded = this.itemSlots.twoHanded;
    if (slot === WEAPON_SLOT && twoHanded.has(itemId)) {
      this.setSlot(loadout, { kind: "equipment", slot: SHIELD_SLOT }, 0, 0);
    } else if (slot === SHIELD_SLOT && twoHanded.has(loadout.equipment[WEAPON_SLOT * 2])) {
      this.setSlot(loadout, { kind: "equipment", slot: WEAPON_SLOT }, 0, 0);
    }
  }

  // Swaps the selected slot's item for another form of it, keeping the quantity
  transformSlot(itemId) {
    const loadout = this.loadoutFor(this.selectedMember);
    if (!loadout || !this.selection) return;
    const [slotItemId, slotQuantity] = this.selectedSlotContents();
    if (!this.transformOptions(slotItemId).includes(itemId)) return;
    this.setSlot(loadout, this.selection, itemId, slotQuantity);
    if (this.selection.kind === "equipment") this.applyTwoHandedRule(loadout, this.selection.slot, itemId);
    this.changed();
  }

  clearSlot(selection) {
    const loadout = this.loadoutFor(this.selectedMember);
    if (!loadout) return;
    this.setSlot(loadout, selection, 0, 0);
    this.changed();
  }

  changed() {
    this.markDirty(this.currentSetup);
    this.renderMembers();
    this.renderLoadoutAndPicker();
  }

  // ---- Saving ----

  markDirty(setup) {
    if (!setup) return;
    this.dirtySetupIds.add(setup.id);
    this.updateSaveState();
  }

  updateSaveState() {
    const dirty = this.dirtySetupIds.size;
    if (this.saveButton) this.saveButton.disabled = dirty === 0 || this.saving;
    if (this.discardButton) this.discardButton.disabled = dirty === 0 || this.saving;
    if (dirty > 0 && !this.saving) {
      this.setStatus(dirty === 1 ? "Unsaved changes" : `Unsaved changes in ${dirty} setups`);
    }
  }

  // Saves every setup with unsaved changes
  async saveDirtySetups() {
    if (this.saving) return; // the in-flight save picks up anything newly dirty when it finishes
    this.saving = true;
    this.updateSaveState();
    let failed = false;
    let conflictMessage = null;
    let setupId;
    try {
      while (this.dirtySetupIds.size > 0) {
        [setupId] = this.dirtySetupIds;
        this.dirtySetupIds.delete(setupId);
        const setup = this.setups.find((x) => x.id === setupId);
        if (!setup) continue;
        if (!setup.name.trim()) {
          this.dirtySetupIds.add(setupId);
          this.setStatus("Setup needs a name before it can be saved", true);
          failed = true;
          break;
        }

        const memberNames = new Set(this.memberNames);
        const members = {};
        for (const [name, loadout] of Object.entries(setup.members)) {
          if (memberNames.has(name) && !isEmptyLoadout(loadout)) members[name] = loadout;
        }

        this.setStatus("Saving...");
        const result = await api.updateLoadoutSetup({ id: setup.id, name: setup.name, version: setup.version, members });
        if (result.ok) {
          setup.version = result.data.version;
          if (this.dirtySetupIds.size === 0 && !conflictMessage) this.setStatus("Saved");
        } else if (result.status === 409 || result.status === 404) {
          conflictMessage = await this.reloadAfterConflict(setupId);
        } else {
          this.dirtySetupIds.add(setupId);
          this.setStatus(`Failed to save: ${result.data || result.status}`, true);
          failed = true;
          break;
        }
      }
    } catch (error) {
      // Keep the setup that was being saved marked as unsaved so it can be retried
      if (setupId !== undefined && this.setups.some((x) => x.id === setupId)) this.dirtySetupIds.add(setupId);
      this.setStatus(`Failed to save: ${error}`, true);
      failed = true;
    } finally {
      this.saving = false;
      if (failed) {
        if (this.saveButton) this.saveButton.disabled = false;
        if (this.discardButton) this.discardButton.disabled = false;
      } else {
        this.updateSaveState();
        // Saving later setups overwrote the status, so show the conflict again
        if (conflictMessage) this.setStatus(conflictMessage, true);
      }
    }
  }

  discardChanges() {
    confirmDialogManager.confirm({
      headline: "Discard unsaved changes?",
      body: "Every setup goes back to how it was last saved.",
      yesCallback: async () => {
        this.dirtySetupIds.clear();
        try {
          await this.loadSetups();
        } catch (error) {
          this.setStatus(`Failed to reload setups: ${error}`, true);
          return;
        }
        this.selection = null;
        this.renderAll();
        this.updateSaveState();
        this.setStatus("Changes discarded");
      },
      noCallback: () => {},
    });
  }

  // Replaces just the conflicting setup with the server's copy, so unsaved edits in other
  // setups are kept. A setup someone else deleted is dropped.
  async reloadAfterConflict(setupId) {
    const result = await api.getLoadouts();
    if (!result.ok) throw new Error(result.data || result.status);
    const latest = result.data.find((x) => x.id === setupId);
    const name = this.setups.find((x) => x.id === setupId)?.name || "A setup";
    this.setups = latest
      ? this.setups.map((x) => (x.id === setupId ? latest : x))
      : this.setups.filter((x) => x.id !== setupId);
    if (!this.currentSetup) this.currentSetupId = this.setups[0]?.id ?? null;
    const message = latest
      ? `${name} was changed by someone else, so its latest version was loaded and your edits to it were dropped`
      : `${name} was deleted by someone else`;
    if (this.isConnected) {
      this.renderAll();
      this.setStatus(message, true);
    }
    return message;
  }

  // ---- Events ----

  handleClick(event) {
    this.closeContextMenu();
    const target = event.target.closest("[data-action]");
    if (!target || !this.contains(target)) return;
    const action = target.getAttribute("data-action");

    if (action === "save") {
      this.saveDirtySetups();
    } else if (action === "discard") {
      this.discardChanges();
    } else if (action === "new-setup") {
      this.createSetup();
    } else if (action === "delete-setup") {
      this.deleteSetup();
    } else if (action === "select-member" || action === "edit-member") {
      this.view = "edit";
      this.selectedMember = target.getAttribute("data-member");
      this.selection = null;
      this.renderMembers();
      this.renderLoadoutAndPicker();
    } else if (action === "select-slot") {
      this.selectSlotElement(target);
      this.renderMembers();
      this.renderLoadoutAndPicker();
      this.focusSearch();
    } else if (action === "pick") {
      this.placeItem(parseInt(target.getAttribute("data-item-id")));
    } else if (action === "remove") {
      if (this.selection) this.clearSlot(this.selection);
    } else if (action === "clear-selection") {
      this.clearSelection();
      this.focusSearch();
    } else if (action === "transform") {
      this.transformSlot(parseInt(target.getAttribute("data-item-id")));
    } else if (action === "view-overview") {
      this.view = "overview";
      this.selection = null;
      this.renderMembers();
      this.renderLoadoutAndPicker();
    }
  }

  // Right-clicking a filled slot opens a menu like the game's, with Remove and any transforms
  handleContextMenu(event) {
    const target = event.target.closest('[data-action="select-slot"]');
    if (!target) return;
    event.preventDefault();
    this.selectSlotElement(target);
    this.renderMembers();
    this.renderLoadoutAndPicker();

    const [itemId] = this.selectedSlotContents();
    if (!itemId) {
      this.closeContextMenu();
      return;
    }
    const options = this.transformOptions(itemId).map(
      (form) => `<button type="button" data-action="transform" data-item-id="${form}">
        Transform into <span class="gear-page__context-item">${utility.escapeHtml(Item.itemName(form))}</span></button>`
    );
    options.push(`<button type="button" data-action="remove">
      Remove <span class="gear-page__context-item">${utility.escapeHtml(Item.itemName(itemId))}</span></button>`);
    this.contextMenu.innerHTML = options.join("");
    this.contextMenu.style.left = `${event.clientX}px`;
    this.contextMenu.style.top = `${event.clientY}px`;
    this.contextMenu.classList.add("open");
  }

  // Escape closes the right-click menu, or else goes back to searching all items
  handleKeyDown(event) {
    if (event.key !== "Escape") return;
    if (this.contextMenu?.classList.contains("open")) {
      this.closeContextMenu();
    } else if (this.selection) {
      this.clearSelection();
    }
  }

  clearSelection() {
    this.selection = null;
    this.renderLoadoutAndPicker();
  }

  closeContextMenu() {
    this.contextMenu?.classList.remove("open");
  }

  // Select the existing text so typing replaces the last search. Skipped on touch screens,
  // where focusing would pop up the keyboard over the page.
  focusSearch() {
    const input = this.searchElement.searchInput;
    if (!input || window.matchMedia?.("(pointer: coarse)").matches) return;
    input.focus();
    input.select();
  }

  locationFromElement(el) {
    const member = el.getAttribute("data-member");
    return el.getAttribute("data-kind") === "equipment"
      ? { member, kind: "equipment", slot: parseInt(el.getAttribute("data-slot")) }
      : { member, kind: "inventory", index: parseInt(el.getAttribute("data-index")) };
  }

  selectSlotElement(el) {
    const { member, ...selection } = this.locationFromElement(el);
    this.selectedMember = member;
    this.selection = selection;
  }

  // ---- Dragging items between slots ----

  handleDragStart(event) {
    const pick = event.target.closest?.(".gear-page__pick");
    const slot = event.target.closest?.('.gear-page__slot[draggable="true"]');
    if (!pick && !slot) return;
    this.closeContextMenu();
    // Either an item from the picker list or one already in a slot
    this.dragSource = pick ? { pickerItemId: parseInt(pick.dataset.itemId) } : this.locationFromElement(slot);
    (pick || slot).classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    // Firefox won't start a drag without some data
    event.dataTransfer.setData("text/plain", "");
  }

  handleDragOver(event) {
    if (!this.dragSource) return;
    const slot = event.target.closest(".gear-page__slot");
    this.setDropTarget(slot);
    if (slot && this.dropItem(this.dragSource, this.locationFromElement(slot), true)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      slot.classList.add("drop-ok");
    }
  }

  handleDrop(event) {
    if (!this.dragSource) return;
    event.preventDefault();
    const slot = event.target.closest(".gear-page__slot");
    const from = this.dragSource;
    this.handleDragEnd();
    if (!slot) return;
    const to = this.locationFromElement(slot);
    if (!this.dropItem(from, to)) return;
    // Dropping from an unfocused search keeps it unfocused so more items can be dragged out
    if (from.pickerItemId === undefined || this.selection) {
      const { member, ...selection } = to;
      this.selectedMember = member;
      this.selection = selection;
    }
    this.changed();
  }

  dropItem(from, to, dryRun = false) {
    return from.pickerItemId !== undefined
      ? this.placeItemAt(to, from.pickerItemId, dryRun)
      : this.moveItem(from, to, dryRun);
  }

  handleDragEnd() {
    this.dragSource = null;
    this.setDropTarget(null);
    this.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
  }

  setDropTarget(slot) {
    if (this.dropTarget && this.dropTarget !== slot) this.dropTarget.classList.remove("drop-ok");
    this.dropTarget = slot;
  }

  handleSetupChange() {
    this.currentSetupId = parseInt(this.setupSelect.value);
    this.selection = null;
    this.renderAll();
  }

  handleSetupNameInput() {
    const setup = this.currentSetup;
    if (!setup) return;
    setup.name = this.setupNameInput.value;
    const option = this.setupSelect.querySelector(`option[value="${setup.id}"]`);
    if (option) option.textContent = setup.name || "(unnamed)";
    this.markDirty(setup);
  }

  async createSetup() {
    const result = await api.createLoadoutSetup(`Setup ${this.setups.length + 1}`);
    if (!result.ok) {
      this.setStatus(`Failed to create setup: ${result.data || result.status}`, true);
      return;
    }
    this.setups.push(result.data);
    this.currentSetupId = result.data.id;
    this.selection = null;
    this.renderAll();
    this.setupNameInput.focus();
    this.setupNameInput.select();
  }

  deleteSetup() {
    const setup = this.currentSetup;
    if (!setup) return;
    confirmDialogManager.confirm({
      headline: `Delete ${setup.name}?`,
      body: "Every member's loadout in this setup will be deleted.",
      yesCallback: async () => {
        this.dirtySetupIds.delete(setup.id);
        const result = await api.deleteLoadoutSetup(setup.id);
        if (!result.ok && result.status !== 404) {
          this.setStatus(`Failed to delete setup: ${result.data || result.status}`, true);
          return;
        }
        this.setups = this.setups.filter((x) => x.id !== setup.id);
        this.currentSetupId = this.setups[0]?.id ?? null;
        this.selection = null;
        this.renderAll();
        this.updateSaveState();
        this.setStatus("Deleted");
      },
      noCallback: () => {},
    });
  }

  setStatus(text, isError = false) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("gear-page__status--error", isError);
  }

  // ---- Rendering ----

  renderAll() {
    if (!this.memberNames.includes(this.selectedMember)) this.selectedMember = this.memberNames[0] || null;
    this.renderSetups();
    this.renderMembers();
    this.renderLoadoutAndPicker();
  }

  renderLoadoutAndPicker() {
    if (!this.itemSlots) return;
    const used = this.usedQuantities();
    const overview = this.view === "overview";
    this.classList.toggle("gear-page--overview", overview);
    if (overview) {
      this.renderOverview(used);
    } else {
      this.renderLoadout(used);
    }
    this.renderPicker(used);
    this.renderWarnings(used);
  }

  renderOverview(used) {
    const setup = this.currentSetup;
    if (!setup) {
      this.overviewEl.innerHTML = `<p>No gear setups yet. Create one with <b>New setup</b>.</p>`;
      return;
    }
    this.overviewEl.innerHTML = this.memberNames
      .map((name) => {
        const loadout = setup.members[name] || emptyLoadout();
        const escapedName = utility.escapeHtml(name);
        const editing = name === this.selectedMember && this.selection ? "gear-page__overview-card--editing" : "";
        return `<div class="gear-page__overview-card ${editing} rsborder rsbackground">
          <div class="gear-page__overview-head">
            <h3>${escapedName}</h3>
            <button class="men-button small" type="button" data-action="edit-member" data-member="${escapedName}">Edit</button>
          </div>
          <div class="equipment">${this.equipmentHtml(loadout, used, name)}</div>
          <div class="gear-page__inventory">
            <div class="player-inventory__background"></div>
            <div class="player-inventory__inventory">${this.inventoryHtml(loadout, used, name)}</div>
          </div>
        </div>`;
      })
      .join("");
  }

  renderSetups() {
    const setup = this.currentSetup;
    this.setupSelect.innerHTML = this.setups.length
      ? this.setups
          .map(
            (x) =>
              `<option value="${x.id}" ${x.id === this.currentSetupId ? "selected" : ""}>${
                utility.escapeHtml(x.name) || "(unnamed)"
              }</option>`
          )
          .join("")
      : `<option value="">No setups yet</option>`;
    this.setupSelect.disabled = this.setups.length === 0;
    this.setupNameInput.value = setup?.name || "";
    this.setupNameInput.disabled = !setup;
    this.querySelector('[data-action="delete-setup"]').disabled = !setup;
    this.classList.toggle("gear-page--empty", !setup);
  }

  // Overview comes first, then a button per member that opens their loadout on its own
  renderMembers() {
    const setup = this.currentSetup;
    const overview = this.view === "overview";
    const overviewButton = `<button class="men-button small ${overview ? "active" : ""}" type="button"
      data-action="view-overview">Overview</button>`;
    this.membersEl.innerHTML =
      overviewButton +
      this.memberNames
        .map((name) => {
          const hasLoadout = setup?.members[name] && !isEmptyLoadout(setup.members[name]);
          return `<button class="men-button small ${!overview && name === this.selectedMember ? "active" : ""}" type="button"
          data-action="select-member" data-member="${utility.escapeHtml(name)}">${utility.escapeHtml(name)}${
            hasLoadout ? " *" : ""
          }</button>`;
        })
        .join("");
  }

  slotHtml(itemId, quantity, used, member) {
    if (!itemId) return "";
    const over = this.usedQuantity(itemId, used, member) > this.ownedQuantity(itemId, member);
    return `<item-box item-id="${itemId}" item-quantity="${quantity}" class="${over ? "gear-page__over" : ""}"></item-box>`;
  }

  renderLoadout(used) {
    const loadout = this.loadoutFor(this.selectedMember) || emptyLoadout();
    const disabled = !this.currentSetup || !this.selectedMember;
    this.classList.toggle("gear-page--disabled", disabled);
    this.equipmentEl.innerHTML = this.equipmentHtml(loadout, used, this.selectedMember);
    this.inventoryEl.innerHTML = this.inventoryHtml(loadout, used, this.selectedMember);
  }

  // Slots carry their member's name, so a click in the overview knows whose loadout to edit
  equipmentHtml(loadout, used, memberName) {
    const isSelectedMember = memberName === this.selectedMember;
    const member = utility.escapeHtml(memberName || "");
    return EQUIPMENT_SLOTS.map(({ slot, name, className, emptyImage }) => {
      const itemId = loadout.equipment[slot * 2];
      const selected = isSelectedMember && this.selection?.kind === "equipment" && this.selection.slot === slot;
      return `<div class="equipment-slot ${className} gear-page__slot ${selected ? "selected" : ""}" title="${name}"
        draggable="${itemId ? "true" : "false"}"
        data-action="select-slot" data-member="${member}" data-kind="equipment" data-slot="${slot}">
        ${itemId ? this.slotHtml(itemId, loadout.equipment[slot * 2 + 1], used, memberName) : `<img src="/ui/${emptyImage}" draggable="false" />`}
      </div>`;
    }).join("");
  }

  inventoryHtml(loadout, used, memberName) {
    const isSelectedMember = memberName === this.selectedMember;
    const member = utility.escapeHtml(memberName || "");
    let html = "";
    for (let index = 0; index < INVENTORY_SIZE; ++index) {
      const selected = isSelectedMember && this.selection?.kind === "inventory" && this.selection.index === index;
      html += `<div class="gear-page__inventory-cell gear-page__slot ${selected ? "selected" : ""}"
        draggable="${loadout.inventory[index * 2] ? "true" : "false"}"
        data-action="select-slot" data-member="${member}" data-kind="inventory" data-index="${index}">
        ${this.slotHtml(loadout.inventory[index * 2], loadout.inventory[index * 2 + 1], used, memberName)}
      </div>`;
    }
    return html;
  }

  renderPicker(used = this.usedQuantities()) {
    if (!this.itemSlots) return;
    // With no slot selected the quantity applies to items dragged into inventory, weapon or ammo slots
    this.quantityLabel.classList.toggle("gear-page__hidden", !!this.selection && !this.selectionAllowsQuantity());

    if (!this.currentSetup) {
      this.pickerHeadEl.innerHTML = `<h3>No gear setups yet</h3><p>Create one with <b>New setup</b>.</p>`;
      this.pickerListEl.innerHTML = "";
      return;
    }
    const focused = !!this.selection && !!this.selectedMember;
    if (focused) {
      const [slotItemId, slotQuantity] = this.selectedSlotContents();
      const slotName =
        this.selection.kind === "equipment"
          ? EQUIPMENT_SLOTS.find((x) => x.slot === this.selection.slot).name
          : `Inventory slot ${this.selection.index + 1}`;
      this.pickerHeadEl.innerHTML = `<h3>${utility.escapeHtml(this.selectedMember)}: ${slotName}</h3>
        <p>
          ${
            slotItemId
              ? `${utility.escapeHtml(Item.itemName(slotItemId))}${slotQuantity > 1 ? ` x ${slotQuantity.toLocaleString()}` : ""}
                 <button class="men-button small" type="button" data-action="remove">Remove</button>`
              : ""
          }
          <button class="men-button small" type="button" data-action="clear-selection">Search all</button>
        </p>`;
    } else {
      this.pickerHeadEl.innerHTML = `<h3>Group items</h3>
        <p>Drag items onto any slot they fit, or click a slot to pick for it. Drag between slots to move or swap, and right-click a slot for more options.</p>`;
    }

    const search = (this.searchElement.value || "").trim().toLowerCase();
    // Also offer pool forms the group doesn't hold directly but could make, like a Purging staff from a Scorching bow
    const itemIds = new Set(Object.values(groupData.items).map((item) => item.id));
    for (const pool of ITEM_POOLS) {
      if (this.ownedQuantity(pool.forms[0]) > 0) pool.forms.forEach((form) => itemIds.add(form));
    }
    const candidates = [];
    for (const itemId of itemIds) {
      if (focused && !this.fitsSelection(itemId)) continue;
      const item = { id: itemId, name: Item.itemName(itemId) };
      if (search && !item.name.toLowerCase().includes(search)) continue;
      const available = this.availableQuantity(itemId, used);
      if (available <= 0) continue;
      candidates.push({ item, available });
    }
    candidates.sort((a, b) => a.item.name.localeCompare(b.item.name));

    if (candidates.length === 0) {
      this.pickerListEl.innerHTML = focused
        ? `<p class="gear-page__empty">No available group items fit this slot${search ? " and match the search" : ""}.</p>`
        : `<p class="gear-page__empty">No available group items${search ? " match the search" : ""}.</p>`;
      return;
    }

    this.pickerListEl.innerHTML =
      candidates
        .slice(0, MAX_PICKER_RESULTS)
        .map(
          ({ item, available }) => {
            // In the unfocused list, say where wearable items go
            const slot = focused ? null : EQUIPMENT_SLOTS.find((x) => x.slot === this.itemSlots.slots[item.id]);
            return `<button class="gear-page__pick rsbackground-hover" type="button" draggable="true"
              data-action="pick" data-item-id="${item.id}" ${focused ? "" : `title="Drag onto a slot"`}>
              <img src="${Item.imageUrl(item.id, 1)}" loading="lazy" draggable="false" />
              <span class="gear-page__pick-name">${utility.escapeHtml(item.name)}</span>
              ${slot ? `<span class="gear-page__pick-slot">${slot.name}</span>` : ""}
              ${
                !focused && this.isOwnerOnly(item.id)
                  ? `<span class="gear-page__pick-slot" title="Untradeable, only its owner can use it">${utility.escapeHtml(this.owners(item.id).join(", "))} only</span>`
                  : ""
              }
              <span class="gear-page__pick-available">${available.toLocaleString()} available</span>
            </button>`;
          }
        )
        .join("") +
      (candidates.length > MAX_PICKER_RESULTS
        ? `<p class="gear-page__empty">${candidates.length - MAX_PICKER_RESULTS} more, search to narrow down</p>`
        : "");
  }

  // Items can run short after a setup is made, e.g. supplies get used up
  renderWarnings(used) {
    const warnings = [];
    const checkedPools = new Set();
    for (const itemId of used.keys()) {
      if (this.isOwnerOnly(itemId)) {
        for (const member of this.memberNames) {
          const quantity = this.memberUsedQuantity(itemId, member);
          const owned = this.ownedQuantity(itemId, member);
          if (quantity > owned) {
            warnings.push(
              `${utility.escapeHtml(Item.itemName(itemId))} (untradeable): ${utility.escapeHtml(member)}'s loadout uses ${quantity.toLocaleString()}, ${utility.escapeHtml(member)} has ${owned.toLocaleString()}`
            );
          }
        }
        continue;
      }
      const pool = POOL_BY_ITEM.get(itemId);
      if (pool && checkedPools.has(pool)) continue;
      if (pool) checkedPools.add(pool);
      const quantity = this.usedQuantity(itemId, used);
      const owned = this.ownedQuantity(itemId);
      if (quantity > owned) {
        const name = pool
          ? `${pool.name} items (${pool.forms.map((form) => Item.itemName(form)).join(", ")})`
          : Item.itemName(itemId);
        warnings.push(
          `${utility.escapeHtml(name)}: setup uses ${quantity.toLocaleString()}, group has ${owned.toLocaleString()}`
        );
      }
    }
    this.warningsEl.innerHTML = warnings.length
      ? `<div class="rsborder-tiny rsbackground"><b>Not enough items for this setup:</b><ul>${warnings
          .map((x) => `<li>${x}</li>`)
          .join("")}</ul></div>`
      : "";
  }
}

customElements.define("gear-page", GearPage);
