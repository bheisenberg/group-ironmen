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
    itemSlotsPromise = fetch("/data/item_slots.json")
      .then((response) => response.json())
      .then(({ slots, twoHanded }) => ({ slots, twoHanded: new Set(twoHanded) }));
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
    this.eventListener(this.setupSelect, "change", this.handleSetupChange.bind(this));
    this.eventListener(this.setupNameInput, "input", this.handleSetupNameInput.bind(this));
    this.eventListener(this.searchElement, "input", () => this.renderPicker());
    this.eventListener(window, "beforeunload", this.handleBeforeUnload.bind(this), { passive: false });
    this.contextMenu = this.querySelector(".gear-page__context-menu");
    this.eventListener(document, "keydown", (event) => event.key === "Escape" && this.closeContextMenu());
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

  // [itemId, quantity] in the selected member's selected slot
  selectedSlotContents() {
    const loadout = this.loadoutFor(this.selectedMember);
    if (!loadout || !this.selection) return [0, 0];
    const [array, index] = this.slotLocation(loadout, this.selection);
    return [array[index], array[index + 1]];
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

  ownedQuantity(itemId) {
    return this.limitIds(itemId).reduce((total, id) => total + (groupData.items[id]?.quantity || 0), 0);
  }

  usedQuantity(itemId, used) {
    return this.limitIds(itemId).reduce((total, id) => total + (used.get(id) || 0), 0);
  }

  // How many more of an item can go in the selected slot, counting what's already in it
  availableQuantity(itemId, used) {
    const [slotItemId, slotQuantity] = this.selectedSlotContents();
    const freed = this.limitIds(itemId).includes(slotItemId) ? slotQuantity : 0;
    return this.ownedQuantity(itemId) - this.usedQuantity(itemId, used) + freed;
  }

  transformOptions(itemId) {
    return POOL_BY_ITEM.get(itemId)?.forms.filter((form) => form !== itemId) || [];
  }

  selectionAllowsQuantity() {
    if (!this.selection) return false;
    return this.selection.kind === "inventory" || [WEAPON_SLOT, AMMO_SLOT].includes(this.selection.slot);
  }

  fitsSelection(itemId) {
    if (this.selection.kind === "inventory") return true;
    return this.itemSlots.slots[itemId] === this.selection.slot;
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

  selectSlotElement(el) {
    this.selectedMember = el.getAttribute("data-member");
    this.selection =
      el.getAttribute("data-kind") === "equipment"
        ? { kind: "equipment", slot: parseInt(el.getAttribute("data-slot")) }
        : { kind: "inventory", index: parseInt(el.getAttribute("data-index")) };
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

  slotHtml(itemId, quantity, used) {
    if (!itemId) return "";
    const over = this.usedQuantity(itemId, used) > this.ownedQuantity(itemId);
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
        data-action="select-slot" data-member="${member}" data-kind="equipment" data-slot="${slot}">
        ${itemId ? this.slotHtml(itemId, loadout.equipment[slot * 2 + 1], used) : `<img src="/ui/${emptyImage}" />`}
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
        data-action="select-slot" data-member="${member}" data-kind="inventory" data-index="${index}">
        ${this.slotHtml(loadout.inventory[index * 2], loadout.inventory[index * 2 + 1], used)}
      </div>`;
    }
    return html;
  }

  renderPicker(used = this.usedQuantities()) {
    if (!this.itemSlots) return;
    this.quantityLabel.classList.toggle("gear-page__hidden", !this.selectionAllowsQuantity());

    if (!this.currentSetup) {
      this.pickerHeadEl.innerHTML = `<h3>No gear setups yet</h3><p>Create one with <b>New setup</b>.</p>`;
      this.pickerListEl.innerHTML = "";
      return;
    }
    if (!this.selection || !this.selectedMember) {
      this.pickerHeadEl.innerHTML = `<h3>Choose a slot</h3>
        <p>Click an equipment or inventory slot, then pick from the group's items. Right-click a slot for more options.</p>`;
      this.pickerListEl.innerHTML = "";
      return;
    }

    const [slotItemId, slotQuantity] = this.selectedSlotContents();
    const slotName =
      this.selection.kind === "equipment"
        ? EQUIPMENT_SLOTS.find((x) => x.slot === this.selection.slot).name
        : `Inventory slot ${this.selection.index + 1}`;
    this.pickerHeadEl.innerHTML = `<h3>${utility.escapeHtml(this.selectedMember)}: ${slotName}</h3>
      ${
        slotItemId
          ? `<p>${utility.escapeHtml(Item.itemName(slotItemId))}${slotQuantity > 1 ? ` x ${slotQuantity.toLocaleString()}` : ""}
             <button class="men-button small" type="button" data-action="remove">Remove</button></p>`
          : ""
      }`;

    const search = (this.searchElement.value || "").trim().toLowerCase();
    // Also offer pool forms the group doesn't hold directly but could make, like a Purging staff from a Scorching bow
    const itemIds = new Set(Object.values(groupData.items).map((item) => item.id));
    for (const pool of ITEM_POOLS) {
      if (this.ownedQuantity(pool.forms[0]) > 0) pool.forms.forEach((form) => itemIds.add(form));
    }
    const candidates = [];
    for (const itemId of itemIds) {
      if (!this.fitsSelection(itemId)) continue;
      const item = { id: itemId, name: Item.itemName(itemId) };
      if (search && !item.name.toLowerCase().includes(search)) continue;
      const available = this.availableQuantity(itemId, used);
      if (available <= 0) continue;
      candidates.push({ item, available });
    }
    candidates.sort((a, b) => a.item.name.localeCompare(b.item.name));

    if (candidates.length === 0) {
      this.pickerListEl.innerHTML = `<p class="gear-page__empty">No available group items fit this slot${
        search ? " and match the search" : ""
      }.</p>`;
      return;
    }

    this.pickerListEl.innerHTML =
      candidates
        .slice(0, MAX_PICKER_RESULTS)
        .map(
          ({ item, available }) => `<button class="gear-page__pick rsbackground-hover" type="button"
            data-action="pick" data-item-id="${item.id}">
            <img src="${Item.imageUrl(item.id, 1)}" loading="lazy" />
            <span class="gear-page__pick-name">${utility.escapeHtml(item.name)}</span>
            <span class="gear-page__pick-available">${available.toLocaleString()} available</span>
          </button>`
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
