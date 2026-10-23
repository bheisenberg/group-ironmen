import { BaseElement } from "../base-element/base-element";
import { storage } from "../data/storage";

export class MenHomepage extends BaseElement {
  constructor() {
    super();
  }

  html() {
    return `{{men-homepage.html}}`;
  }

  connectedCallback() {
    super.connectedCallback();
    this.render();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  get hasLogin() {
    const group = storage.getGroup();
    return group && group.groupName && group.groupToken && group.groupName !== "@EXAMPLE";
  }

  get showDemo() {
    return new URLSearchParams(window.location.search).has("demo");
  }
}

customElements.define("men-homepage", MenHomepage);
