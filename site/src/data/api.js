import { pubsub } from "./pubsub";
import { utility } from "../utility";
import { groupData } from "./group-data";
import { exampleData } from "./example-data";

class Api {
  constructor() {
    this.baseUrl = "/api";
    this.createGroupUrl = `${this.baseUrl}/create-group`;
    this.exampleDataEnabled = false;
    this.enabled = false;
  }

  get getGroupDataUrl() {
    return `${this.baseUrl}/group/${this.groupName}/get-group-data`;
  }

  get addMemberUrl() {
    return `${this.baseUrl}/group/${this.groupName}/add-group-member`;
  }

  get deleteMemberUrl() {
    return `${this.baseUrl}/group/${this.groupName}/delete-group-member`;
  }

  get renameMemberUrl() {
    return `${this.baseUrl}/group/${this.groupName}/rename-group-member`;
  }

  get amILoggedInUrl() {
    return `${this.baseUrl}/group/${this.groupName}/am-i-logged-in`;
  }

  get gePricesUrl() {
    return `${this.baseUrl}/ge-prices`;
  }

  get skillDataUrl() {
    return `${this.baseUrl}/group/${this.groupName}/get-skill-data`;
  }

  get memberOrderUrl() {
    return `${this.baseUrl}/group/${this.groupName}/member-order`;
  }

  get loadoutsUrl() {
    return `${this.baseUrl}/group/${this.groupName}/loadouts`;
  }

  get captchaEnabledUrl() {
    return `${this.baseUrl}/captcha-enabled`;
  }

  setCredentials(groupName, groupToken) {
    this.groupName = groupName;
    this.groupToken = groupToken;
  }

  async restart() {
    const groupName = this.groupName;
    const groupToken = this.groupToken;
    await this.enable(groupName, groupToken);
  }

  async enable(groupName, groupToken) {
    await this.disable();
    this.nextCheck = new Date(0).toISOString();
    this.memberOrderPolls = 0;
    this.setCredentials(groupName, groupToken);

    if (!this.enabled) {
      this.enabled = true;
      // getGroupInterval is a Promise so we can make sure this method does not leak
      // any intervals with multiple calls to .enable(). This could be possible because of
      // the wait for the item and quest data loads before we create the interval.
      this.getGroupInterval = pubsub.waitForAllEvents("item-data-loaded", "quest-data-loaded").then(() => {
        return utility.callOnInterval(this.getGroupData.bind(this), 1000);
      });
    }

    await this.getGroupInterval;
  }

  async disable() {
    this.enabled = false;
    this.groupName = undefined;
    this.groupToken = undefined;
    groupData.members = new Map();
    groupData.memberOrder = [];
    groupData.groupItems = {};
    groupData.potionStorageItems = {};
    groupData.items = {};
    groupData.filters = [""];
    if (this.getGroupInterval) {
      window.clearInterval(await this.getGroupInterval);
    }
  }

  async getGroupData() {
    const nextCheck = this.nextCheck;

    if (this.exampleDataEnabled) {
      const newGroupData = exampleData.getGroupData();
      groupData.update(newGroupData);
      pubsub.publish("get-group-data", groupData);
    } else {
      const response = await fetch(`${this.getGroupDataUrl}?from_time=${nextCheck}`, {
        headers: {
          Authorization: this.groupToken,
        },
      });
      if (!response.ok) {
        if (response.status === 401) {
          await this.disable();
          window.history.pushState("", "", "/login");
          pubsub.publish("get-group-data");
        }
        return;
      }

      const newGroupData = await response.json();
      this.nextCheck = groupData.update(newGroupData).toISOString();
      pubsub.publish("get-group-data", groupData);
    }

    // Load the member order with the first group data, then every 30 polls so changes
    // someone else makes in settings show up without a reload
    if (this.memberOrderPolls++ % 30 === 0) this.refreshMemberOrder();
  }

  async refreshMemberOrder() {
    try {
      const result = await this.getMemberOrder();
      if (result.ok) groupData.applyMemberOrder(result.data);
    } catch {
      // Keep the current order; the next refresh will try again
    }
  }

  // Resolves to { ok, status, data } where data is the ordered member names
  async getMemberOrder() {
    if (this.exampleDataEnabled) return { ok: true, status: 200, data: exampleData.getMemberOrder() };
    return this.loadoutRequest(this.memberOrderUrl, "GET");
  }

  async setMemberOrder(memberNames) {
    if (this.exampleDataEnabled) return { ok: true, status: 200, data: exampleData.setMemberOrder(memberNames) };
    return this.loadoutRequest(this.memberOrderUrl, "PUT", { member_names: memberNames });
  }

  async createGroup(groupName, memberNames, captchaResponse) {
    const response = await fetch(this.createGroupUrl, {
      body: JSON.stringify({ name: groupName, member_names: memberNames, captcha_response: captchaResponse }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    return response;
  }

  async addMember(memberName) {
    const response = await fetch(this.addMemberUrl, {
      body: JSON.stringify({ name: memberName }),
      headers: {
        "Content-Type": "application/json",
        Authorization: this.groupToken,
      },
      method: "POST",
    });

    return response;
  }

  async removeMember(memberName) {
    const response = await fetch(this.deleteMemberUrl, {
      body: JSON.stringify({ name: memberName }),
      headers: {
        "Content-Type": "application/json",
        Authorization: this.groupToken,
      },
      method: "DELETE",
    });

    return response;
  }

  async renameMember(originalName, newName) {
    const response = await fetch(this.renameMemberUrl, {
      body: JSON.stringify({ original_name: originalName, new_name: newName }),
      headers: {
        "Content-Type": "application/json",
        Authorization: this.groupToken,
      },
      method: "PUT",
    });

    return response;
  }

  async amILoggedIn() {
    const response = await fetch(this.amILoggedInUrl, {
      headers: { Authorization: this.groupToken },
    });

    return response;
  }

  async getGePrices() {
    const response = await fetch(this.gePricesUrl);
    return response;
  }

  async getSkillData(period) {
    if (this.exampleDataEnabled) {
      const skillData = exampleData.getSkillData(period, groupData);
      return skillData;
    } else {
      const response = await fetch(`${this.skillDataUrl}?period=${period}`, {
        headers: {
          Authorization: this.groupToken,
        },
      });
      return response.json();
    }
  }

  // Loadout setups resolve to { ok, status, data }. The demo keeps them in memory instead.
  async getLoadouts() {
    if (this.exampleDataEnabled) return { ok: true, status: 200, data: exampleData.getLoadouts() };
    return this.loadoutRequest(this.loadoutsUrl, "GET");
  }

  async createLoadoutSetup(name) {
    if (this.exampleDataEnabled) return { ok: true, status: 200, data: exampleData.createLoadoutSetup(name) };
    return this.loadoutRequest(this.loadoutsUrl, "POST", { name });
  }

  async updateLoadoutSetup(setup) {
    if (this.exampleDataEnabled) return exampleData.updateLoadoutSetup(setup);
    const { name, version, members, member_order, hidden_members } = setup;
    return this.loadoutRequest(`${this.loadoutsUrl}/${setup.id}`, "PUT", {
      name,
      version,
      members,
      member_order,
      hidden_members,
    });
  }

  async deleteLoadoutSetup(setupId) {
    if (this.exampleDataEnabled) return exampleData.deleteLoadoutSetup(setupId);
    return this.loadoutRequest(`${this.loadoutsUrl}/${setupId}`, "DELETE");
  }

  async loadoutRequest(url, method, body) {
    const headers = { Authorization: this.groupToken };
    if (body) headers["Content-Type"] = "application/json";
    const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let data = text;
    if (response.ok && text) {
      data = JSON.parse(text);
    }
    return { ok: response.ok, status: response.status, data };
  }

  async getCaptchaEnabled() {
    const response = await fetch(this.captchaEnabledUrl);
    return response.json();
  }
}

const api = new Api();

export { api };
