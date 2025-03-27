import { DivComponent } from "../../common/div-component.js";
import "./news-card.css";

export class NewsCard extends DivComponent {
  constructor(appState, cardState) {
    super();
    this.appState = appState;
    this.cardState = cardState;
  }

  #addToReadLater() {
    this.appState.readLater.push(this.cardState);
  }

  #deleteFromReadLater() {
    this.appState.readLater = this.appState.readLater.filter((news) => {
      news.url !== this.cardState.url;
    });
  }

  render() {
    const existInReadLater = this.appState.readLater.find((news) => {
      news.url === this.cardState.url;
    });
    // console.log(existInReadLater);
    this.element.classList.add("news-card");
    this.element.innerHTML = `
    <button class="button_add ${existInReadLater ? "button_add_active" : ""}">
        <img
          src="./static/icons/${
            existInReadLater ? "favorites-white" : "favorites"
          }.svg"
          alt="Иконка добавить в закладки"
        />
      </button>
    <div class="news-card__image">
      <img src="${this.cardState.urlToImage}" alt="Фотография из новости" />
    </div>
    <div class="news-card__title">${this.cardState.title}</div>
    <div class="news-card__info">
      <div class="news-card__author">${
        this.cardState.author === null ? "———" : this.cardState.author
      }</div>
      <div class="news-card__source">${this.cardState.source.name}</div>
    </div>
    <div class="news-card__description">${
      this.cardState.description
    } <a href="${this.cardState.url}" target="_self">[Читать далее]</a></div>
    `;

    if (existInReadLater) {
      this.element
        .querySelector("button")
        .addEventListener("click", this.#deleteFromReadLater.bind(this));
    } else {
      this.element
        .querySelector("button")
        .addEventListener("click", this.#addToReadLater.bind(this));
    }

    return this.element;
  }
}
