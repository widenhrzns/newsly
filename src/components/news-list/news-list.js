import { DivComponent } from "../../common/div-component.js";
import "./news-list.css";

export class NewsList extends DivComponent {
  constructor(appState, parentState) {
    super();
    this.appState = appState;
    this.parentState = parentState;
  }

  render() {
    if (this.parentState.loading) {
      this.element.innerHTML = `<div class='card-list__loader'>Загрузка...</div>`;
      return this.element;
    }
    this.element.classList.add("news-list");
    this.element.innerHTML = `
    <h1>Найдено новостей — ${this.parentState.totalResults}</h1>
    `;
    return this.element;
  }
}
