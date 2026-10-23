// Generates public/data/item_untradeable.json, the ids of items that can't be traded (and so can't
// be passed between group members), for the gear page. Source: the OSRS Wiki's item infoboxes,
// where `tradeable` is present for tradeable items and missing for untradeable ones. Items the
// wiki doesn't know about are left out, so they're treated as tradeable.
// Usage: node scripts/generate-untradeable-items.js
const fs = require("fs");

const PAGE_SIZE = 5000;
const USER_AGENT = "group-ironmen untradeable item list (github.com/bheisenberg/group-ironmen)";

async function fetchPage(offset) {
  const query = `bucket('infobox_item').select('item_id','tradeable').limit(${PAGE_SIZE}).offset(${offset}).run()`;
  const url = `https://oldschool.runescape.wiki/api.php?action=bucket&format=json&query=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Wiki request failed: ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.bucket)) throw new Error(`Unexpected wiki response: ${JSON.stringify(body).slice(0, 200)}`);
  return body.bucket;
}

async function main() {
  const itemData = JSON.parse(fs.readFileSync("public/data/item_data.json", "utf8"));
  const untradeable = new Set();
  const tradeable = new Set();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await fetchPage(offset);
    for (const row of rows) {
      const ids = Array.isArray(row.item_id) ? row.item_id : [row.item_id];
      for (const id of ids) {
        if (!itemData[id]) continue;
        ("tradeable" in row ? tradeable : untradeable).add(parseInt(id));
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }
  // An id listed by several infoboxes counts as tradeable if any of them says so
  const ids = [...untradeable].filter((id) => !tradeable.has(id)).sort((a, b) => a - b);
  fs.writeFileSync("public/data/item_untradeable.json", JSON.stringify(ids));
  console.log(`Wrote ${ids.length} untradeable items (${tradeable.size} tradeable)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
