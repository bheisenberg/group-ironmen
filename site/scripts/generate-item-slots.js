// Generates public/data/item_slots.json, the equipment slot of every wearable item, for the gear page.
// Source: the item stats RuneLite serves to its client. Equipment slot numbers match the game's
// equipment container indexes (0 head ... 13 ammo), which is what player-equipment uses too.
// Usage: node scripts/generate-item-slots.js
const fs = require("fs");

const STATS_URL = "https://static.runelite.net/item/stats.ids.min.json";

async function main() {
  const response = await fetch(STATS_URL);
  if (!response.ok) throw new Error(`Failed to fetch ${STATS_URL}: ${response.status}`);
  const stats = await response.json();
  const itemData = JSON.parse(fs.readFileSync("public/data/item_data.json", "utf8"));

  const slots = {};
  const twoHanded = [];
  for (const [id, stat] of Object.entries(stats)) {
    // Only items the site knows about, so the file stays small
    if (!stat.equipable || !itemData[id]) continue;
    // The minified stats omit zero values, so a missing slot means 0 (head)
    slots[id] = stat.equipment?.slot || 0;
    if (stat.equipment?.is2h) twoHanded.push(parseInt(id));
  }

  fs.writeFileSync("public/data/item_slots.json", JSON.stringify({ slots, twoHanded }));
  console.log(`Wrote ${Object.keys(slots).length} equipable items (${twoHanded.length} two-handed)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
