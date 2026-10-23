import { BaseElement } from "../base-element/base-element";
import { storage } from "../data/storage";
import { api } from "../data/api";

export class LoginPage extends BaseElement {
  constructor() {
    super();
  }

  html() {
    return `{{login-page.html}}`;
  }

  connectedCallback() {
    super.connectedCallback();
    this.render();

    const fieldRequiredValidator = (value) => {
      if (value.length === 0) {
        return "This field is required.";
      }
    };
    this.token = this.querySelector(".login__token");
    this.token.validators = [fieldRequiredValidator];
    this.loginButton = this.querySelector(".login__button");
    this.error = this.querySelector(".login__error");
    this.eventListener(this.loginButton, "click", this.login.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  async login() {
    if (!this.token.valid) return;
    try {
      this.error.innerHTML = "";
      this.loginButton.disabled = true;
      const token = this.token.value;
      // The server identifies the group by its token alone and ignores the name in the URL,
      // so log in with a placeholder and keep the real name it sends back
      api.setCredentials("group", token);
      const response = await api.amILoggedIn();
      if (response.ok) {
        const { group_name: name } = await response.json();
        storage.storeGroup(name, token);
        window.history.pushState("", "", "/group");
      } else {
        if (response.status === 401) {
          this.error.innerHTML = "Group token is incorrect";
        } else {
          const body = await response.text();
          this.error.innerHTML = `Unable to login ${body}`;
        }
      }
    } catch (error) {
      this.error.innerHTML = `Unable to login ${error}`;
    } finally {
      this.loginButton.disabled = false;
    }
  }
}

customElements.define("login-page", LoginPage);
