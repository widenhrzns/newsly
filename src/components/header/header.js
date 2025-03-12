import { DivComponent } from "../../common/div-component.js";
import "./header.css";

export class Header extends DivComponent {
  constructor(appState) {
    super();
    this.appState = appState;
  }

  render() {
    const currentPath = location.hash;
    this.element.classList.add("header");
    this.element.innerHTML = `
    <a class="logo" href="#">NEWSLY</a>
      <div class="menu">
        <a class="menu__item ${
          currentPath === "#search" ? "menu__item_active" : ""
        }" href="#search">
          <img src="./static/icons/search.svg" alt="Иконка поиска" />
          Поиск
        </a>
        <a class="menu__item ${
          currentPath === "#readLater" ? "menu__item_active" : ""
        }" href="#readLater">
          <img src="./static/icons/favorites.svg" alt="Иконка поиска" />
          Закладки
          <div>${this.appState.readLater.length}</div>
        </a>
    `;
    return this.element;
  }
}
