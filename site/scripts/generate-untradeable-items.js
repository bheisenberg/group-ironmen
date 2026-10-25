// Generates public/data/item_untradeable.json, the ids of items that can't be traded (and so can't
// be passed between group members), for the gear page. Source: the OSRS Wiki's item infoboxes,
// where `tradeable` is present for tradeable items and missing for untradeable ones. Items the
// wiki doesn't know about are left out, so they're treated as tradeable.
// Items that are only untradeable while charged (Toxic blowpipe, Scythe of Vitur, ...) are also
// left out, since they can be uncharged into a tradeable form and charged again. These are the
// untradeable versions on a charged-item page that also has a tradeable version.
// Usage: node scripts/generate-untradeable-items.js
const fs = require("fs");

const PAGE_SIZE = 5000;
const USER_AGENT = "group-ironmen untradeable item list (github.com/bheisenberg/group-ironmen)";
// Wiki categories of pages whose untradeable versions are just charged forms of a tradeable one.
// The Sailing blowpipes aren't tagged as items with charges, so their category is listed too.
const CHARGED_CATEGORIES = ["Items with charges", "Blowpipes"];
// Untradeable items the wiki has no tradeable version of, but that revert into a tradeable item
const REVERTIBLE_ITEMS = [
  28687 /* Blazing blowpipe (empty), a Toxic blowpipe with an ornament kit */,
  28688 /* Blazing blowpipe */,
];

async function wikiApi(params) {
  const url = `https://oldschool.runescape.wiki/api.php?format=json&${new URLSearchParams(params)}`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Wiki request failed: ${response.status}`);
  return response.json();
}

async function fetchPage(offset) {
  const query = `bucket('infobox_item').select('item_id','tradeable','page_name').limit(${PAGE_SIZE}).offset(${offset}).run()`;
  const body = await wikiApi({ action: "bucket", query });
  if (!Array.isArray(body.bucket)) throw new Error(`Unexpected wiki response: ${JSON.stringify(body).slice(0, 200)}`);
  return body.bucket;
}

async function fetchCategoryPages(category) {
  const pages = [];
  let cmcontinue;
  do {
    const params = { action: "query", list: "categorymembers", cmtitle: `Category:${category}`, cmlimit: 500 };
    if (cmcontinue) params.cmcontinue = cmcontinue;
    const body = await wikiApi(params);
    if (!body.query) throw new Error(`Unexpected wiki response: ${JSON.stringify(body).slice(0, 200)}`);
    pages.push(...body.query.categorymembers.filter((member) => member.ns === 0).map((member) => member.title));
    cmcontinue = body.continue?.cmcontinue;
  } while (cmcontinue);
  return pages;
}

async function main() {
  const itemData = JSON.parse(fs.readFileSync("public/data/item_data.json", "utf8"));
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchPage(offset);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const chargedPages = new Set((await Promise.all(CHARGED_CATEGORIES.map(fetchCategoryPages))).flat());
  const tradeablePages = new Set(rows.filter((row) => "tradeable" in row).map((row) => row.page_name));

  const untradeable = new Set();
  const tradeable = new Set();
  let chargedCount = 0;
  for (const row of rows) {
    const chargedForm = chargedPages.has(row.page_name) && tradeablePages.has(row.page_name);
    const ids = Array.isArray(row.item_id) ? row.item_id : [row.item_id];
    for (const id of ids) {
      if (!itemData[id]) continue;
      if ("tradeable" in row) tradeable.add(parseInt(id));
      else if (chargedForm || REVERTIBLE_ITEMS.includes(parseInt(id))) chargedCount++;
      else untradeable.add(parseInt(id));
    }
  }
  // An id listed by several infoboxes counts as tradeable if any of them says so
  const ids = [...untradeable].filter((id) => !tradeable.has(id)).sort((a, b) => a - b);
  fs.writeFileSync("public/data/item_untradeable.json", JSON.stringify(ids));
  console.log(
    `Wrote ${ids.length} untradeable items (${tradeable.size} tradeable, ${chargedCount} untradeable only while charged or ornamented)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
