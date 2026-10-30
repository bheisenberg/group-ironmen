// Generates public/data/item_untradeable.json, the ids of items that can't be traded (and so can't
// be passed between group members), for the gear page. Source: the OSRS Wiki's item infoboxes,
// where `tradeable` is present for tradeable items and missing for untradeable ones. Items the
// wiki doesn't know about are left out, so they're treated as tradeable.
// Items that are only untradeable while charged (Toxic blowpipe, Scythe of Vitur, ...) are also
// left out, since they can be uncharged into a tradeable form and charged again. These are the
// untradeable versions on a charged-item page that also has a tradeable version.
// Also generates public/data/item_charge_forms.json, the charged and uncharged forms of the same
// item, so the gear page can treat them as one item. Each entry is [charged form, other forms...].
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
// Wiki version names of an item's charged form, in order of preference, and of its other forms. A
// partially charged Trident of the Seas is the usual one, its fully charged version is "Charged".
const CHARGED_VERSIONS = ["Partially charged", "Charged", "Active"];
const UNCHARGED_VERSIONS = ["Uncharged", "Empty", "Inactive", "Inert", "New"];

// [charged form, other forms...] for each charged-item page with a charged form and other forms
function chargeForms(rows, chargedPages, itemData) {
  const versionsByPage = new Map();
  for (const row of rows) {
    if (!chargedPages.has(row.page_name)) continue;
    const ids = (Array.isArray(row.item_id) ? row.item_id : [row.item_id]).map((id) => parseInt(id));
    if (!versionsByPage.has(row.page_name)) versionsByPage.set(row.page_name, []);
    versionsByPage.get(row.page_name).push({ version: row.version_anchor, ids: ids.filter((id) => itemData[id]) });
  }
  const groups = [];
  for (const versions of versionsByPage.values()) {
    const charged = CHARGED_VERSIONS.map((name) => versions.find((x) => x.version === name)).find((x) => x?.ids.length);
    if (!charged) continue;
    const others = versions
      .filter((x) => CHARGED_VERSIONS.includes(x.version) || UNCHARGED_VERSIONS.includes(x.version))
      .flatMap((x) => x.ids)
      .filter((id) => id !== charged.ids[0]);
    if (others.length > 0) groups.push([charged.ids[0], ...others]);
  }
  return groups.sort((a, b) => a[0] - b[0]);
}

async function wikiApi(params) {
  const url = `https://oldschool.runescape.wiki/api.php?format=json&${new URLSearchParams(params)}`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Wiki request failed: ${response.status}`);
  return response.json();
}

async function fetchPage(offset) {
  const query = `bucket('infobox_item').select('item_id','tradeable','page_name','version_anchor').limit(${PAGE_SIZE}).offset(${offset}).run()`;
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

  const groups = chargeForms(rows, chargedPages, itemData);
  fs.writeFileSync("public/data/item_charge_forms.json", JSON.stringify(groups));
  console.log(`Wrote ${groups.length} charged items with other forms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
