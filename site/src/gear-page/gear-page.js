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
  // Not a game slot: the ammo held by a worn Dizana's quiver, shown only while one is worn
  { slot: 14, name: "Quiver", className: "gear-page__quiver-slot", emptyImage: "166-0.png" },
];
const CAPE_SLOT = 1;
const WEAPON_SLOT = 3;
const SHIELD_SLOT = 5;
const AMMO_SLOT = 13;
const QUIVER_SLOT = 14;
const EQUIPMENT_SIZE = 15;
const INVENTORY_SIZE = 28;
const MAX_PICKER_RESULTS = 120;
// How long after the last edit changes are saved, and how long to wait before retrying a failed save
const AUTOSAVE_DELAY_MS = 1000;
const AUTOSAVE_RETRY_MS = 10000;

// The combat simulator that "Open in sim" opens a member's loadout in. It loads the saved setup
// from this site, so change this to point the buttons at another sim.
export const SIM_URL = "https://sim.meatmen.men";

// The sim page for one member's loadout in a saved setup
export function simLoadoutUrl(setupId, member) {
  return `${SIM_URL}/?gim-setup=${encodeURIComponent(setupId)}&gim-member=${encodeURIComponent(member)}`;
}

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

// Capes with a quiver's extra ammo slot. Broken quivers can't hold ammo, so they're left out.
const QUIVER_CAPES = new Set([
  28947 /* Dizana's quiver (uncharged) */, 28949 /* Dizana's quiver (l) (uncharged) */, 28951 /* Dizana's quiver */,
  28953 /* Dizana's quiver (l) */, 28955 /* Blessed Dizana's quiver */, 28957 /* Blessed Dizana's quiver (l) */,
  28902 /* Dizana's max cape */, 28906 /* Dizana's max cape (l) */,
]);

// RuneLite bank tag tab layouts are 8 items wide. An exported loadout puts the equipment on the
// left, laid out like the worn equipment screen, and the inventory's 4 columns on the right.
const BANK_ROW_LENGTH = 8;
const TAG_TAB_EQUIPMENT_CELLS = {
  [QUIVER_SLOT]: [0, 0],
  0: [0, 1],
  1: [1, 0],
  2: [1, 1],
  13: [1, 2],
  3: [2, 0],
  4: [2, 1],
  5: [2, 2],
  7: [3, 1],
  9: [4, 0],
  10: [4, 1],
  12: [4, 2],
};
const TAG_TAB_INVENTORY_COLUMN = 4;

function equipmentScreenLayout(loadout) {
  const layout = [];
  for (const [slot, [row, column]] of Object.entries(TAG_TAB_EQUIPMENT_CELLS)) {
    const itemId = loadout.equipment[slot * 2];
    if (itemId) layout.push([row * BANK_ROW_LENGTH + column, itemId]);
  }
  for (let index = 0; index < INVENTORY_SIZE; ++index) {
    const itemId = loadout.inventory[index * 2];
    const row = Math.floor(index / 4);
    const column = TAG_TAB_INVENTORY_COLUMN + (index % 4);
    if (itemId) layout.push([row * BANK_ROW_LENGTH + column, itemId]);
  }
  return layout;
}

// The Inventory Setups plugin's ZigZag layout, with its default top to bottom order: items go
// down and up pairs of rows (0, 8, 1, 9, ...), equipment in slot order from the top, then the
// quiver's ammo, and the inventory from the third row
const ZIGZAG_INVENTORY_START = 2 * BANK_ROW_LENGTH;
function zigzagPosition(n) {
  const pairOfRows = Math.floor(n / (2 * BANK_ROW_LENGTH));
  const inPair = n % (2 * BANK_ROW_LENGTH);
  return pairOfRows * 2 * BANK_ROW_LENGTH + (inPair % 2) * BANK_ROW_LENGTH + Math.floor(inPair / 2);
}

function zigzagLayout(loadout) {
  const layout = [];
  const equipment = [];
  for (let slot = 0; slot < QUIVER_SLOT; ++slot) {
    if (loadout.equipment[slot * 2]) equipment.push(loadout.equipment[slot * 2]);
  }
  if (loadout.equipment[QUIVER_SLOT * 2]) equipment.push(loadout.equipment[QUIVER_SLOT * 2]);
  equipment.forEach((itemId, n) => layout.push([zigzagPosition(n), itemId]));
  const inventory = [];
  for (let index = 0; index < INVENTORY_SIZE; ++index) {
    if (loadout.inventory[index * 2]) inventory.push(loadout.inventory[index * 2]);
  }
  inventory.forEach((itemId, n) => layout.push([ZIGZAG_INVENTORY_START + zigzagPosition(n), itemId]));
  return layout;
}

// A loadout as a RuneLite bank tag tab, for its "Import tag tab" option. Format:
// banktags,1,<name>,<icon item>,layout,<position>,<item>,<position>,<item>,...
export function tagTabExport(name, loadout, zigzag = false) {
  const layout = zigzag ? zigzagLayout(loadout) : equipmentScreenLayout(loadout);
  if (layout.length === 0) return null;

  // Tag names can't have RuneLite's markup characters, or commas since the export is comma separated
  const tagName = name.replace(/[</>:,]/g, "").trim() || "gear";
  const icon = loadout.equipment[WEAPON_SLOT * 2] || layout[0][1];
  return ["banktags", 1, tagName, icon, "layout", ...layout.flat()].join(",");
}

let itemSlotsPromise;
function loadItemSlots() {
  if (!itemSlotsPromise) {
    const getJson = (url) => fetch(url).then((response) => response.json());
    itemSlotsPromise = Promise.all([
      getJson("/data/item_slots.json"),
      getJson("/data/item_untradeable.json"),
      getJson("/data/item_charge_forms.json"),
    ]).then(([{ slots, twoHanded }, untradeable, chargeForms]) => ({
      slots,
      twoHanded: new Set(twoHanded),
      untradeable: new Set(untradeable),
      chargeForms: chargeFormsByItem(chargeForms),
    }));
    itemSlotsPromise.catch(() => (itemSlotsPromise = undefined));
  }
  return itemSlotsPromise;
}

// Each of an item's forms, e.g. a Scythe of Vitur and its uncharged form, maps to all of its forms
// with the charged one first
function chargeFormsByItem(groups) {
  return new Map(groups.flatMap((forms) => forms.map((itemId) => [itemId, forms])));
}

function emptyLoadout() {
  return { equipment: new Array(EQUIPMENT_SIZE * 2).fill(0), inventory: new Array(INVENTORY_SIZE * 2).fill(0) };
}

function hasQuiver(loadout) {
  return QUIVER_CAPES.has(loadout?.equipment[CAPE_SLOT * 2]);
}

// Loadouts saved before the quiver slot existed have one less equipment slot
function normalizeSetup(setup) {
  setup.member_order = setup.member_order || [];
  setup.hidden_members = setup.hidden_members || [];
  for (const loadout of Object.values(setup.members)) {
    while (loadout.equipment.length < EQUIPMENT_SIZE * 2) loadout.equipment.push(0);
  }
  return setup;
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
    this.setupListEl = this.querySelector(".gear-page__setup-list");

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
    this.openLinkedSetup();
    this.renderAll();
    // Edits kept from the last visit weren't saved yet
    if (this.dirtySetupIds.size > 0) this.scheduleAutosave();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Leaving the page saves right away instead of waiting out the autosave delay
    if (this.dirtySetupIds?.size > 0) this.saveDirtySetups();
  }

  // Ask before closing or reloading the tab while changes are still saving
  handleBeforeUnload(event) {
    if (this.dirtySetupIds.size === 0) return;
    this.saveDirtySetups();
    event.preventDefault();
    event.returnValue = "";
  }

  get currentSetup() {
    return this.setups.find((setup) => setup.id === this.currentSetupId) || null;
  }

  get memberNames() {
    return [...groupData.members.keys()].filter((name) => name !== "@SHARED");
  }

  // The members the current setup shows, in its order. Members it doesn't place yet (e.g. newly
  // added) follow in the group's order.
  get visibleMembers() {
    const setup = this.currentSetup;
    if (!setup) return this.memberNames;
    const position = new Map(setup.member_order.map((name, i) => [name.toLowerCase(), i]));
    const rank = (name) => position.get(name.toLowerCase()) ?? setup.member_order.length;
    const hidden = new Set(setup.hidden_members.map((name) => name.toLowerCase()));
    return this.memberNames.filter((name) => !hidden.has(name.toLowerCase())).sort((a, b) => rank(a) - rank(b));
  }

  get hiddenMembers() {
    const visible = new Set(this.visibleMembers);
    return this.memberNames.filter((name) => !visible.has(name));
  }

  async loadSetups() {
    const result = await api.getLoadouts();
    if (!result.ok) throw new Error(result.data || result.status);
    this.setups = result.data.map(normalizeSetup);
    if (!this.currentSetup) this.currentSetupId = null;
  }

  // A shared link names its setup, e.g. /group/gear?setup=12. Without one the page opens on the
  // list of setups.
  openLinkedSetup() {
    const linked = new URLSearchParams(window.location.search).get("setup");
    if (linked === null) {
      this.currentSetupId = null;
      this.selection = null;
      return;
    }
    const setupId = parseInt(linked);
    if (this.setups.some((setup) => setup.id === setupId)) {
      if (setupId !== this.currentSetupId) this.selection = null;
      this.currentSetupId = setupId;
    } else {
      this.setStatus("The linked setup doesn't exist anymore", true);
    }
  }

  // Keeps the address bar on the current setup, so it can be bookmarked or shared
  syncUrl() {
    if (!this.isConnected) return;
    const url = new URL(window.location.href);
    if (this.currentSetupId !== null) {
      url.searchParams.set("setup", this.currentSetupId);
    } else {
      url.searchParams.delete("setup");
    }
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }

  // The export button's dropdown, which reuses the right-click menu, under the button
  openExportMenu(button) {
    const member = utility.escapeHtml(button.getAttribute("data-member"));
    this.openMenuUnder(
      button,
      `<button type="button" data-action="export-tag-tab" data-member="${member}">Equipment screen layout</button>
      <button type="button" data-action="export-tag-tab" data-zigzag data-member="${member}">Zigzag layout</button>`
    );
  }

  // A member card's "..." menu, for the rarely needed options
  openMemberMenu(button) {
    const member = utility.escapeHtml(button.getAttribute("data-member"));
    this.openMenuUnder(
      button,
      `<button type="button" data-action="hide-member" data-member="${member}">Remove player</button>`,
      true
    );
  }

  // Opens the right-click menu as a dropdown under a button, lined up with its right edge if alignRight
  openMenuUnder(button, html, alignRight = false) {
    this.contextMenu.innerHTML = html;
    this.contextMenu.classList.add("open");
    const rect = button.getBoundingClientRect();
    const left = alignRight ? rect.right - this.contextMenu.offsetWidth : rect.left;
    this.contextMenu.style.left = `${Math.max(0, left)}px`;
    this.contextMenu.style.top = `${rect.bottom}px`;
  }

  async copyTagTab(member, zigzag) {
    const setup = this.currentSetup;
    const loadout = this.loadoutFor(member);
    const exported = setup && loadout && tagTabExport(`${setup.name} ${member}`, loadout, zigzag);
    if (!exported) {
      this.setStatus(`${member} has nothing to export in this setup`, true);
      return;
    }
    try {
      await navigator.clipboard.writeText(exported);
      this.setStatus(
        `Copied ${member}'s tag tab. In the bank, right-click the add tab button and choose Import tag tab.`
      );
    } catch {
      this.setStatus("Couldn't copy the tag tab to the clipboard", true);
    }
  }

  // Opens a member's loadout in the sim in a new tab. The sim reads the saved setup, so pending
  // edits are saved first.
  async openInSim(member) {
    const setup = this.currentSetup;
    const loadout = this.loadoutFor(member);
    if (setup?.id == null || !loadout || isEmptyLoadout(loadout)) return;
    if (this.dirtySetupIds.has(setup.id)) await this.saveDirtySetups();
    window.open(simLoadoutUrl(setup.id, member), "_blank", "noopener");
    if (this.dirtySetupIds.has(setup.id)) {
      this.setStatus("Couldn't save your changes, so the sim opened the last saved version", true);
    }
  }

  async copySetupLink() {
    const setup = this.currentSetup;
    if (!setup) return;
    const url = `${window.location.origin}/group/gear?setup=${setup.id}`;
    if (this.dirtySetupIds.has(setup.id)) await this.saveDirtySetups();
    try {
      await navigator.clipboard.writeText(url);
      this.setStatus(
        this.dirtySetupIds.has(setup.id) ? "Link copied, but your latest changes aren't saved yet" : "Link copied"
      );
    } catch {
      this.setStatus(`Couldn't copy the link: ${url}`, true);
    }
  }

  handleMembersUpdated() {
    if (!this.visibleMembers.includes(this.selectedMember)) {
      this.selectedMember = this.visibleMembers[0] || null;
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

  // The item ids that share an item's limit: its whole pool, its charged and uncharged forms, or
  // just itself
  limitIds(itemId) {
    const pool = POOL_BY_ITEM.get(itemId);
    if (pool) return [...pool.forms, ...pool.alsoCounts];
    return this.itemSlots?.chargeForms?.get(itemId) || [itemId];
  }

  // Items go into a setup charged, since charges are easy to add before the trip
  chargedForm(itemId) {
    return this.itemSlots?.chargeForms?.get(itemId)?.[0] ?? itemId;
  }

  // Untradeable items can't be passed between members (not even through group storage), so only
  // the member holding one can use it. Items that are only untradeable while charged (blowpipes,
  // tridents, ...) aren't in the untradeable list to begin with, and an item with any tradeable
  // form can be traded in that form. Synapse weapons are untradeable but are left out: they can be
  // dismantled into a tradeable synapse and made again.
  isOwnerOnly(itemId) {
    const untradeable = this.itemSlots?.untradeable;
    return !!untradeable && !POOL_BY_ITEM.has(itemId) && this.limitIds(itemId).every((id) => untradeable.has(id));
  }

  // With a member, an owner-only item counts just what that member holds and uses
  ownedQuantity(itemId, member = null) {
    const owner = member && this.isOwnerOnly(itemId) ? member : null;
    return this.limitIds(itemId).reduce((total, id) => {
      const item = groupData.items[id];
      return total + ((owner ? item?.quantities?.[owner] : item?.quantity) || 0);
    }, 0);
  }

  usedQuantity(itemId, used, member = null) {
    if (member && this.isOwnerOnly(itemId)) return this.memberUsedQuantity(itemId, member);
    return this.limitIds(itemId).reduce((total, id) => total + (used.get(id) || 0), 0);
  }

  memberUsedQuantity(itemId, member) {
    const loadout = this.loadoutFor(member);
    const ids = this.limitIds(itemId);
    let total = 0;
    for (const array of loadout ? [loadout.equipment, loadout.inventory] : []) {
      for (let i = 0; i < array.length; i += 2) {
        if (ids.includes(array[i])) total += array[i + 1];
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
        (total, member) =>
          total + Math.max(0, this.ownedQuantity(itemId, member) - this.memberUsedQuantity(itemId, member)),
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
    return location.kind === "inventory" || [WEAPON_SLOT, AMMO_SLOT, QUIVER_SLOT].includes(location.slot);
  }

  // The quiver slot takes ammo, and only exists while its member wears a quiver
  fitsLocation(itemId, location) {
    if (location.kind === "inventory") return true;
    if (location.slot === QUIVER_SLOT) {
      return (
        this.itemSlots.slots[itemId] === AMMO_SLOT && hasQuiver(this.loadoutFor(location.member ?? this.selectedMember))
      );
    }
    return this.itemSlots.slots[itemId] === location.slot;
  }

  selectionAllowsQuantity() {
    return !!this.selection && this.allowsQuantity(this.selection);
  }

  fitsSelection(itemId) {
    return this.fitsLocation(itemId, this.selectedLocation);
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
    // A quiver's ammo is inside it, so it goes along when the quiver moves to another member
    if (from.kind === "equipment" && to.kind === "equipment" && to.slot === CAPE_SLOT && fromLoadout !== toLoadout) {
      const quiverIndex = QUIVER_SLOT * 2;
      for (const i of [quiverIndex, quiverIndex + 1]) {
        [fromLoadout.equipment[i], toLoadout.equipment[i]] = [
          toLoadout.equipment[i] || 0,
          fromLoadout.equipment[i] || 0,
        ];
      }
    }
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
    itemId = this.chargedForm(itemId);
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
    itemId = this.chargedForm(itemId);
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
    this.applyQuiverRule();
    this.markDirty(this.currentSetup);
    this.renderMembers();
    this.renderLoadoutAndPicker();
  }

  // Taking off a quiver takes its ammo with it, so a loadout without one has an empty quiver slot
  applyQuiverRule() {
    for (const [member, loadout] of Object.entries(this.currentSetup?.members || {})) {
      if (hasQuiver(loadout) || !loadout.equipment[QUIVER_SLOT * 2]) continue;
      this.setSlot(loadout, { kind: "equipment", slot: QUIVER_SLOT }, 0, 0);
      if (member === this.selectedMember && this.selection?.slot === QUIVER_SLOT) this.selection = null;
    }
  }

  // ---- Saving ----

  markDirty(setup) {
    if (!setup) return;
    this.dirtySetupIds.add(setup.id);
    this.scheduleAutosave();
  }

  // Saves once edits have paused for a moment, so a burst of changes is one save
  scheduleAutosave(delay = AUTOSAVE_DELAY_MS) {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.saveDirtySetups(), delay);
  }

  // The loadouts worth saving: current members' non-empty ones
  savableMembers(setup) {
    const memberNames = new Set(this.memberNames);
    const members = {};
    for (const [name, loadout] of Object.entries(setup.members)) {
      if (memberNames.has(name) && !isEmptyLoadout(loadout)) members[name] = loadout;
    }
    return members;
  }

  // The member layout, without members who have since left the group
  savableLayout(setup) {
    const memberNames = new Set(this.memberNames);
    return {
      member_order: setup.member_order.filter((name) => memberNames.has(name)),
      hidden_members: setup.hidden_members.filter((name) => memberNames.has(name)),
    };
  }

  // Saves every setup with unsaved changes. Calls during a save wait for it, and it picks up
  // anything newly dirty before it finishes.
  saveDirtySetups() {
    clearTimeout(this.autosaveTimer);
    if (!this.savePromise) {
      this.savePromise = this.saveAll().finally(() => {
        this.savePromise = null;
      });
    }
    return this.savePromise;
  }

  async saveAll() {
    this.saving = true;
    let failed = false;
    let needsName = false;
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
          needsName = true;
          break;
        }

        const members = this.savableMembers(setup);

        this.setStatus("Saving...");
        const result = await api.updateLoadoutSetup({
          ...this.savableLayout(setup),
          id: setup.id,
          name: setup.name,
          version: setup.version,
          members,
        });
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
      // Refresh the "Unsaved changes" labels on the setup cards
      if (this.isConnected && !this.currentSetup) this.renderSetupList();
      if (failed) {
        // Naming the setup saves it, so only retry other failures
        if (!needsName && this.isConnected) this.scheduleAutosave(AUTOSAVE_RETRY_MS);
      } else if (conflictMessage) {
        // Saving later setups overwrote the status, so show the conflict again
        this.setStatus(conflictMessage, true);
      }
    }
  }

  // Replaces just the conflicting setup with the server's copy, so unsaved edits in other
  // setups are kept. A setup someone else deleted is dropped.
  async reloadAfterConflict(setupId) {
    const result = await api.getLoadouts();
    if (!result.ok) throw new Error(result.data || result.status);
    const latest = result.data.find((x) => x.id === setupId);
    const name = this.setups.find((x) => x.id === setupId)?.name || "A setup";
    this.setups = latest
      ? this.setups.map((x) => (x.id === setupId ? normalizeSetup(latest) : x))
      : this.setups.filter((x) => x.id !== setupId);
    if (!this.currentSetup) this.currentSetupId = null;
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
    // Clicking outside the member boxes goes back to searching all items, like Overview does
    const keepsSelection =
      ".gear-page__overview-card, .gear-page__loadout, .gear-page__picker, .gear-page__head, .gear-page__context-menu";
    if (this.selection && !event.target.closest(keepsSelection)) this.clearSelection();
    const target = event.target.closest("[data-action]");
    if (!target || !this.contains(target)) return;
    const action = target.getAttribute("data-action");

    if (action === "new-setup") {
      this.createSetup();
    } else if (action === "delete-setup") {
      this.deleteSetup();
    } else if (action === "copy-link") {
      this.copySetupLink();
    } else if (action === "export-tag-tab") {
      this.copyTagTab(target.getAttribute("data-member"), target.hasAttribute("data-zigzag"));
    } else if (action === "open-in-sim") {
      this.openInSim(target.getAttribute("data-member"));
    } else if (action === "export-menu") {
      this.openExportMenu(target);
    } else if (action === "member-menu") {
      this.openMemberMenu(target);
    } else if (action === "open-setup") {
      this.openSetup(parseInt(target.getAttribute("data-setup-id")));
    } else if (action === "all-setups") {
      this.openSetup(null);
    } else if (action === "hide-member") {
      this.hideMember(target.getAttribute("data-member"));
    } else if (action === "show-member") {
      this.showMember(target.getAttribute("data-member"));
    } else if (action === "select-member") {
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

  // ---- Member layout ----

  // Removing (hiding) a member clears their loadout, so nothing hidden counts toward the group's
  // items. They can be added back from the members bar.
  hideMember(member) {
    const setup = this.currentSetup;
    if (!setup || !this.visibleMembers.includes(member)) return;
    const hide = () => {
      delete setup.members[member];
      setup.hidden_members.push(member);
      if (this.selectedMember === member) {
        this.selectedMember = this.visibleMembers[0] || null;
        this.selection = null;
      }
      this.changed();
    };
    const loadout = setup.members[member];
    const hasLoadout = loadout && !isEmptyLoadout(loadout);
    confirmDialogManager.confirm({
      headline: `Remove ${member} from ${setup.name}?`,
      body: hasLoadout
        ? `${member}'s loadout in this setup will be cleared. They can be added back from the buttons at the top.`
        : "They can be added back from the buttons at the top.",
      yesCallback: hide,
      noCallback: () => {},
    });
  }

  showMember(member) {
    const setup = this.currentSetup;
    if (!setup) return;
    setup.hidden_members = setup.hidden_members.filter((name) => name.toLowerCase() !== member.toLowerCase());
    this.changed();
  }

  // Moves a member just before or after another among the shown members
  moveMember(member, target, after) {
    const setup = this.currentSetup;
    const order = this.visibleMembers.filter((name) => name !== member);
    const targetIndex = order.indexOf(target);
    if (!setup || member === target || targetIndex < 0) return;
    order.splice(targetIndex + (after ? 1 : 0), 0, member);
    setup.member_order = order;
    this.changed();
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
    // Dragging a member's card by its name reorders the members
    const cardHead = event.target.closest?.(".gear-page__overview-head");
    if (cardHead) {
      const card = cardHead.closest(".gear-page__overview-card");
      this.closeContextMenu();
      this.dragSource = { card: card.getAttribute("data-member") };
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", "");
      return;
    }
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
    if (this.dragSource.card !== undefined) {
      const drop = this.cardDropPosition(event);
      this.setCardDropTarget(drop);
      if (drop) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }
      return;
    }
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
    const from = this.dragSource;
    if (from.card !== undefined) {
      const drop = this.cardDropPosition(event);
      this.handleDragEnd();
      if (drop) this.moveMember(from.card, drop.card.getAttribute("data-member"), drop.after);
      return;
    }
    const slot = event.target.closest(".gear-page__slot");
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

  // The card a dragged card is over, and which half, so it drops before or after it
  cardDropPosition(event) {
    const card = event.target.closest(".gear-page__overview-card");
    if (!card || card.getAttribute("data-member") === this.dragSource.card) return null;
    const rect = card.getBoundingClientRect();
    return { card, after: event.clientX > rect.left + rect.width / 2 };
  }

  setCardDropTarget(drop) {
    this.querySelectorAll(".gear-page__overview-card.drop-before, .gear-page__overview-card.drop-after").forEach(
      (el) => {
        if (el !== drop?.card) el.classList.remove("drop-before", "drop-after");
      }
    );
    drop?.card.classList.toggle("drop-before", !drop.after);
    drop?.card.classList.toggle("drop-after", drop.after);
  }

  handleDragEnd() {
    this.dragSource = null;
    this.setDropTarget(null);
    this.setCardDropTarget(null);
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

  // Opens a setup, starting from its overview, or the list of setups with null
  openSetup(setupId) {
    this.currentSetupId = setupId;
    this.view = "overview";
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
    this.setups.push(normalizeSetup(result.data));
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
        this.currentSetupId = null;
        this.selection = null;
        this.renderAll();
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
    if (!this.visibleMembers.includes(this.selectedMember)) this.selectedMember = this.visibleMembers[0] || null;
    this.renderSetups();
    this.renderSetupList();
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
    const visibleMembers = this.visibleMembers;
    if (visibleMembers.length === 0) {
      this.overviewEl.innerHTML = `<p>Every member is hidden in this setup. Show them again from the buttons above.</p>`;
      return;
    }
    this.overviewEl.innerHTML = visibleMembers
      .map((name) => {
        const loadout = setup.members[name] || emptyLoadout();
        const escapedName = utility.escapeHtml(name);
        const editing = name === this.selectedMember && this.selection ? "gear-page__overview-card--editing" : "";
        // Only a saved setup's loadouts can be opened in the sim
        const simButton =
          setup.id != null && !isEmptyLoadout(loadout)
            ? `<button class="men-button small" type="button" data-action="open-in-sim" data-member="${escapedName}"
                draggable="false" title="Open ${escapedName}'s saved loadout in the sim in a new tab">Open in sim</button>`
            : "";
        return `<div class="gear-page__overview-card ${editing} rsborder rsbackground" data-member="${escapedName}">
          <div class="gear-page__overview-head" draggable="true" title="Drag to reorder">
            <h3>${escapedName}</h3>
            ${simButton}
          </div>
          <div class="equipment">${this.equipmentHtml(loadout, used, name)}</div>
          <div class="gear-page__inventory">
            <div class="player-inventory__background"></div>
            <div class="player-inventory__inventory">${this.inventoryHtml(loadout, used, name)}</div>
          </div>
          <div class="gear-page__overview-foot">
            <div class="gear-page__overview-exports">
              <button class="men-button small" type="button" data-action="export-tag-tab" data-member="${escapedName}"
                title="Copy as a RuneLite bank tag tab laid out like the equipment screen and inventory"
                ${isEmptyLoadout(loadout) ? "disabled" : ""}>Export</button>
              <button class="men-button small" type="button" data-action="export-menu" data-member="${escapedName}"
                title="More export layouts" ${isEmptyLoadout(loadout) ? "disabled" : ""}>&#9662;</button>
            </div>
            <button class="men-button small" type="button" data-action="member-menu" data-member="${escapedName}"
              title="More options">&hellip;</button>
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
    this.querySelector('[data-action="copy-link"]').disabled = !setup;
    this.classList.toggle("gear-page--list", !setup);
    this.syncUrl();
  }

  // With no setup open, the page lists every setup to open, and a card to make a new one
  renderSetupList() {
    if (this.currentSetup) {
      this.setupListEl.innerHTML = "";
      return;
    }
    const cards = this.setups.map((setup) => {
      const members = Object.entries(this.savableMembers(setup));
      const weapons = members
        .filter(([, loadout]) => loadout.equipment[WEAPON_SLOT * 2])
        .map(([name, loadout]) => {
          const itemId = loadout.equipment[WEAPON_SLOT * 2];
          const title = utility.escapeHtml(`${name}: ${Item.itemName(itemId)}`);
          return `<img src="${Item.imageUrl(itemId, 1)}" loading="lazy" title="${title}" />`;
        })
        .join("");
      const info = members.length ? members.map(([name]) => name).join(", ") : "No loadouts yet";
      const unsaved = this.dirtySetupIds.has(setup.id)
        ? `<span class="gear-page__setup-card-unsaved">Unsaved changes</span>`
        : "";
      return `<button class="gear-page__setup-card rsborder rsbackground rsbackground-hover" type="button"
          data-action="open-setup" data-setup-id="${setup.id}">
          <span class="gear-page__setup-card-name">${utility.escapeHtml(setup.name) || "(unnamed)"}</span>
          <span class="gear-page__setup-card-weapons">${weapons}</span>
          <span class="gear-page__setup-card-info">${utility.escapeHtml(info)}</span>
          ${unsaved}
        </button>`;
    });
    cards.push(`<button class="gear-page__setup-card gear-page__setup-card--new rsborder rsbackground rsbackground-hover"
        type="button" data-action="new-setup">+ New setup</button>`);
    this.setupListEl.innerHTML = `<h2>Gear setups</h2><div class="gear-page__setup-cards">${cards.join("")}</div>`;
  }

  // Overview comes first, then a button per member that opens their loadout on its own
  renderMembers() {
    const overview = this.view === "overview";
    const overviewButton = `<button class="men-button small ${overview ? "active" : ""}" type="button"
      data-action="view-overview">Overview</button>`;
    const hiddenButtons = this.hiddenMembers
      .map((name) => {
        const escapedName = utility.escapeHtml(name);
        return `<button class="men-button small gear-page__hidden-member" type="button" data-action="show-member"
          data-member="${escapedName}" title="Show ${escapedName} in this setup">+ ${escapedName}</button>`;
      })
      .join("");
    this.membersEl.innerHTML =
      overviewButton +
      this.visibleMembers
        .map(
          (name) => `<button class="men-button small ${
            !overview && name === this.selectedMember ? "active" : ""
          }" type="button"
          data-action="select-member" data-member="${utility.escapeHtml(name)}">${utility.escapeHtml(name)}</button>`
        )
        .join("") +
      hiddenButtons;
  }

  slotHtml(itemId, quantity, used, member) {
    if (!itemId) return "";
    const over = this.usedQuantity(itemId, used, member) > this.ownedQuantity(itemId, member);
    return `<item-box item-id="${itemId}" item-quantity="${quantity}" class="${
      over ? "gear-page__over" : ""
    }"></item-box>`;
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
    const slots = hasQuiver(loadout) ? EQUIPMENT_SLOTS : EQUIPMENT_SLOTS.filter(({ slot }) => slot !== QUIVER_SLOT);
    return slots
      .map(({ slot, name, className, emptyImage }) => {
        const itemId = loadout.equipment[slot * 2];
        const selected = isSelectedMember && this.selection?.kind === "equipment" && this.selection.slot === slot;
        return `<div class="equipment-slot ${className} gear-page__slot ${selected ? "selected" : ""}" title="${name}"
        draggable="${itemId ? "true" : "false"}"
        data-action="select-slot" data-member="${member}" data-kind="equipment" data-slot="${slot}">
        ${
          itemId
            ? this.slotHtml(itemId, loadout.equipment[slot * 2 + 1], used, memberName)
            : `<img src="/ui/${emptyImage}" draggable="false" />`
        }
      </div>`;
      })
      .join("");
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
              ? `${utility.escapeHtml(Item.itemName(slotItemId))}${
                  slotQuantity > 1 ? ` x ${slotQuantity.toLocaleString()}` : ""
                }
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
    // Uncharged items are listed as their charged form, which is what picking them places
    const itemIds = new Set(Object.values(groupData.items).map((item) => this.chargedForm(item.id)));
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
        ? `<p class="gear-page__empty">No available group items fit this slot${
            search ? " and match the search" : ""
          }.</p>`
        : `<p class="gear-page__empty">No available group items${search ? " match the search" : ""}.</p>`;
      return;
    }

    this.pickerListEl.innerHTML =
      candidates
        .slice(0, MAX_PICKER_RESULTS)
        .map(({ item, available }) => {
          // In the unfocused list, say where wearable items go
          const slot = focused ? null : EQUIPMENT_SLOTS.find((x) => x.slot === this.itemSlots.slots[item.id]);
          return `<button class="gear-page__pick rsbackground-hover" type="button" draggable="true"
              data-action="pick" data-item-id="${item.id}" ${focused ? "" : `title="Drag onto a slot"`}>
              <img src="${Item.imageUrl(item.id, 1)}" loading="lazy" draggable="false" />
              <span class="gear-page__pick-name">${utility.escapeHtml(item.name)}</span>
              ${slot ? `<span class="gear-page__pick-slot">${slot.name}</span>` : ""}
              ${
                !focused && this.isOwnerOnly(item.id)
                  ? `<span class="gear-page__pick-slot" title="Untradeable, only its owner can use it">${utility.escapeHtml(
                      this.owners(item.id).join(", ")
                    )} only</span>`
                  : ""
              }
              <span class="gear-page__pick-available">${available.toLocaleString()} available</span>
            </button>`;
        })
        .join("") +
      (candidates.length > MAX_PICKER_RESULTS
        ? `<p class="gear-page__empty">${candidates.length - MAX_PICKER_RESULTS} more, search to narrow down</p>`
        : "");
  }

  // Items can run short after a setup is made, e.g. supplies get used up
  renderWarnings(used) {
    const warnings = [];
    // Items sharing a limit, like a pool or charged and uncharged forms, are checked once
    const checked = new Set();
    for (const itemId of used.keys()) {
      const limitKey = this.limitIds(itemId)[0];
      if (checked.has(limitKey)) continue;
      checked.add(limitKey);
      if (this.isOwnerOnly(itemId)) {
        for (const member of this.memberNames) {
          const quantity = this.memberUsedQuantity(itemId, member);
          const owned = this.ownedQuantity(itemId, member);
          if (quantity > owned) {
            warnings.push(
              `${utility.escapeHtml(Item.itemName(itemId))} (untradeable): ${utility.escapeHtml(
                member
              )}'s loadout uses ${quantity.toLocaleString()}, ${utility.escapeHtml(
                member
              )} has ${owned.toLocaleString()}`
            );
          }
        }
        continue;
      }
      const pool = POOL_BY_ITEM.get(itemId);
      const quantity = this.usedQuantity(itemId, used);
      const owned = this.ownedQuantity(itemId);
      if (quantity > owned) {
        const name = pool
          ? `${pool.name} items (${pool.forms.map((form) => Item.itemName(form)).join(", ")})`
          : Item.itemName(this.chargedForm(itemId));
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
