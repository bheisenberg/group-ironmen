import { utility } from "../utility";
import { pubsub } from "./pubsub";
import { api } from "./api";

export class Item {
  constructor(id, quantity) {
    if (typeof id === "string") {
      this.id = parseInt(id);
    } else {
      this.id = id;
    }
    this.quantity = quantity;
    this.visible = true;
  }

  static imageUrl(itemId, quantity) {
    const itemDetails = Item.itemDetails[itemId];
    let imageId = itemDetails.id;
    if (itemDetails.stacks) {
      for (const stack of itemDetails.stacks) {
        if (quantity >= stack.count) {
          imageId = stack.id;
        }
      }
    }
    return `/icons/items/${imageId}.webp`;
  }

  // For a dosed potion like "Prayer potion(1)", returns the highest dose variant that exists
  // ("Prayer potion(4)", or "(2)" for barbarian mixes) along with the dose counts of both.
  // Returns null for items without a dose suffix, e.g. unfinished potions.
  static maxDoseVariant(itemId) {
    // Caches are built from itemDetails, so start over if it has been replaced
    if (Item.maxDoseVariantSource !== Item.itemDetails) {
      Item.maxDoseVariantSource = Item.itemDetails;
      Item.maxDoseVariantCache = new Map();
      Item.idsByName = null;
    }
    if (Item.maxDoseVariantCache.has(itemId)) return Item.maxDoseVariantCache.get(itemId);

    let result = null;
    const name = Item.itemDetails[itemId]?.name;
    const match = name?.match(/\((\d)\)$/);
    if (match) {
      if (!Item.idsByName) {
        Item.idsByName = new Map();
        for (const [id, details] of Object.entries(Item.itemDetails)) {
          if (!Item.idsByName.has(details.name)) Item.idsByName.set(details.name, []);
          Item.idsByName.get(details.name).push(parseInt(id));
        }
      }

      for (let doses = 9; doses >= 1; --doses) {
        const ids = Item.idsByName.get(name.replace(/\(\d\)$/, `(${doses})`));
        if (!ids) continue;
        // Names can repeat across variants (e.g. Last Man Standing copies), which sit in a
        // different id range, so take the id closest to the one we started from.
        const id = ids.reduce((best, x) => (Math.abs(x - itemId) < Math.abs(best - itemId) ? x : best));
        result = { id, doses, sourceDoses: parseInt(match[1]) };
        break;
      }
    }

    Item.maxDoseVariantCache.set(itemId, result);
    return result;
  }

  static itemName(itemId) {
    return Item.itemDetails[itemId].name;
  }

  static shortQuantity(quantity) {
    return utility.formatShortQuantity(quantity);
  }

  static veryShortQuantity(quantity) {
    return utility.formatVeryShortQuantity(quantity);
  }

  get imageUrl() {
    return Item.imageUrl(this.id, this.quantity);
  }

  get shortQuantity() {
    return Item.shortQuantity(this.quantity);
  }

  get veryShortQuantity() {
    return Item.veryShortQuantity(this.quantity);
  }

  get name() {
    return Item.itemDetails[this.id].name;
  }

  get wikiLink() {
    return `https://oldschool.runescape.wiki/w/Special:Lookup?type=item&id=${this.id}`;
  }

  get highAlch() {
    return Item.itemDetails[this.id].highalch;
  }

  get gePrice() {
    return Item.gePrices[this.id] || 0;
  }

  isValid() {
    return this.id > 0;
  }

  isRunePouch() {
    return this.quantity === 1 && (this.id === 12791 || this.id === 27281);
  }

  static parseItemData(data) {
    const result = [];
    for (let i = 0; i < data.length; ++i) {
      if (data[i].id <= 0) {
        result.push(new Item(0, 0));
        continue;
      }

      if (!Item.itemDetails[data[i].id]) {
        console.warn(`Unrecognized item id: ${data[i].id}`);
        result.push(new Item(0, 0));
        continue;
      }

      const item = new Item(data[i].id, data[i].quantity);
      result.push(item);
    }

    return result;
  }

  static async loadItems() {
    const response = await fetch("/data/item_data.json");
    Item.itemDetails = await response.json();
    for (const [itemId, itemDetails] of Object.entries(Item.itemDetails)) {
      const stacks = itemDetails.stacks;
      itemDetails.stacks = stacks ? stacks.map((stack) => ({ id: stack[1], count: stack[0] })) : null;
      itemDetails.id = itemId;
    }

    pubsub.publish("item-data-loaded");
  }

  static async loadGePrices() {
    const response = await api.getGePrices();
    Item.gePrices = await response.json();
  }

  static randomItem(quantity = null) {
    const keys = Object.keys(Item.itemDetails);
    const key = keys[(keys.length * Math.random()) << 0];
    const item = Item.itemDetails[key];
    return [item.id, quantity ? quantity : Math.round(Math.random() * 100000 + 1)];
  }

  static randomItems(count, quantity) {
    let result = [];
    for (let i = 0; i < count; ++i) {
      result.push(...Item.randomItem(quantity));
    }
    return result;
  }
}
