import { BaseElement } from "../base-element/base-element";
import { appearance } from "../appearance";
import { api } from "../data/api";
import { groupData } from "../data/group-data";
import { utility } from "../utility";

export class GroupSettings extends BaseElement {
  constructor() {
    super();
  }

  /* eslint-disable no-unused-vars */
  html() {
    const selectedPanelDockSide = appearance.getLayout();
    const style = appearance.getTheme();
    return `{{group-settings.html}}`;
  }
  /* eslint-enable no-unused-vars */

  connectedCallback() {
    super.connectedCallback();
    this.render();
    this.addMemberSection = this.querySelector(".group-settings__add-member");
    this.panelDockSide = this.querySelector(".group-settings__panels");
    this.appearanceStyle = this.querySelector(".group-settings__style");
    this.orderList = this.querySelector(".group-settings__order");
    this.orderStatus = this.querySelector(".group-settings__order-status");
    this.eventListener(this.orderList, "dragstart", this.handleDragStart.bind(this));
    this.eventListener(this.orderList, "dragover", this.handleDragOver.bind(this), { passive: false });
    this.eventListener(this.orderList, "drop", this.handleDrop.bind(this), { passive: false });
    this.eventListener(this.orderList, "dragend", this.handleDragEnd.bind(this));
    this.eventListener(this.orderList, "click", this.handleOrderClick.bind(this));
    // Rows only become draggable from their handle, so text in the name inputs can still be selected
    this.eventListener(this.orderList, "pointerdown", this.handlePointerDown.bind(this));
    this.eventListener(document, "pointerup", () => this.disarmDrag());
    this.subscribe("members-updated", this.handleUpdatedMembers.bind(this));
    this.eventListener(this.panelDockSide, "change", this.handlePanelDockSideChange.bind(this));
    this.eventListener(this.appearanceStyle, "change", this.handleStyleChange.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  handleStyleChange() {
    const style = this.querySelector(`input[name="appearance-style"]:checked`).value;
    appearance.setTheme(style);
  }

  handlePanelDockSideChange() {
    const side = this.querySelector(`input[name="panel-dock-side"]:checked`).value;

    if (side === "right") {
      appearance.setLayout("row-reverse");
    } else {
      appearance.setLayout("row");
    }
  }

  // ---- Member order ----

  // One row per member: drag handle, name with rename/remove, and up/down buttons
  renderOrder(memberNames) {
    this.orderNames = memberNames;
    const rows = document.createDocumentFragment();
    memberNames.forEach((name, i) => {
      const escaped = utility.escapeHtml(name);
      const row = document.createElement("li");
      row.className = "group-settings__order-item";
      row.dataset.index = i;
      row.innerHTML = `<span class="group-settings__drag-handle" title="Drag to reorder">&#9776;</span>
        <div class="group-settings__move">
          <button class="men-button small" type="button" data-move="-1" ${i === 0 ? "disabled" : ""}
            aria-label="Move ${escaped} up">&#9650;</button>
          <button class="men-button small" type="button" data-move="1" ${i === memberNames.length - 1 ? "disabled" : ""}
            aria-label="Move ${escaped} down">&#9660;</button>
        </div>`;
      const memberEdit = document.createElement("edit-member");
      memberEdit.member = groupData.members.get(name) || { name };
      memberEdit.memberNumber = i + 1;
      row.insertBefore(memberEdit, row.lastElementChild);
      rows.appendChild(row);
    });
    this.orderList.innerHTML = "";
    this.orderList.appendChild(rows);
  }

  handlePointerDown(event) {
    const handle = event.target.closest(".group-settings__drag-handle");
    if (!handle) return;
    this.armedRow = handle.closest(".group-settings__order-item");
    this.armedRow.draggable = true;
  }

  disarmDrag() {
    if (this.armedRow) this.armedRow.draggable = false;
    this.armedRow = null;
  }

  handleDragStart(event) {
    const item = event.target.closest(".group-settings__order-item");
    if (!item || item !== this.armedRow) return;
    this.dragIndex = parseInt(item.dataset.index);
    item.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    // Firefox won't start a drag without some data
    event.dataTransfer.setData("text/plain", this.orderNames[this.dragIndex]);
  }

  // Index the dragged member would land at: before or after the row under the cursor
  dropIndex(event) {
    const item = event.target.closest(".group-settings__order-item");
    if (!item) return null;
    const rect = item.getBoundingClientRect();
    const index = parseInt(item.dataset.index);
    return event.clientY > rect.top + rect.height / 2 ? index + 1 : index;
  }

  handleDragOver(event) {
    if (this.dragIndex === undefined) return;
    const index = this.dropIndex(event);
    if (index === null) return;
    event.preventDefault();
    for (const item of this.orderList.children) {
      const i = parseInt(item.dataset.index);
      item.classList.toggle("drop-before", i === index);
      item.classList.toggle("drop-after", i === index - 1 && index === this.orderNames.length);
    }
  }

  handleDrop(event) {
    if (this.dragIndex === undefined) return;
    event.preventDefault();
    const index = this.dropIndex(event);
    const from = this.dragIndex;
    this.handleDragEnd();
    if (index === null) return;
    // Removing the dragged member first shifts later positions up by one
    this.moveMember(from, index > from ? index - 1 : index);
  }

  handleDragEnd() {
    this.dragIndex = undefined;
    this.disarmDrag();
    for (const item of this.orderList.children) {
      item.classList.remove("dragging", "drop-before", "drop-after");
    }
  }

  // Up/down buttons, for touch screens where dragging doesn't work
  handleOrderClick(event) {
    const button = event.target.closest("button[data-move]");
    if (!button) return;
    const from = parseInt(button.closest(".group-settings__order-item").dataset.index);
    this.moveMember(from, from + parseInt(button.dataset.move));
  }

  async moveMember(from, to) {
    if (to === from || to < 0 || to >= this.orderNames.length) return;
    const names = [...this.orderNames];
    const [moved] = names.splice(from, 1);
    names.splice(to, 0, moved);
    this.renderOrder(names);

    this.orderStatus.textContent = "Saving...";
    this.orderStatus.classList.remove("validation-error");
    try {
      const result = await api.setMemberOrder(names);
      if (!result.ok) throw new Error(result.data || result.status);
      groupData.applyMemberOrder(result.data);
      this.orderStatus.textContent = "Saved";
    } catch (error) {
      this.renderOrder([...groupData.members.keys()].filter((name) => name !== "@SHARED"));
      this.orderStatus.textContent = `Failed to save the order: ${error.message || error}`;
      this.orderStatus.classList.add("validation-error");
    }
  }

  // ---- Members ----

  handleUpdatedMembers(members) {
    members = members.filter((member) => member.name !== "@SHARED");
    this.renderOrder(members.map((member) => member.name));

    this.addMemberSection.innerHTML = "";
    if (members.length < 5) {
      const addMember = document.createElement("edit-member");
      addMember.memberNumber = members.length + 1;
      this.addMemberSection.appendChild(addMember);
    }
  }
}

customElements.define("group-settings", GroupSettings);
