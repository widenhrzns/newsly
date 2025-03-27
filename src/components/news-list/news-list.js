import { DivComponent } from "../../common/div-component.js";
import { NewsCard } from "../news-card/news-card.js";
import "./news-list.css";

export class NewsList extends DivComponent {
  constructor(appState, parentState) {
    super();
    this.appState = appState;
    this.parentState = parentState;
  }

  render() {
    if (this.parentState.loading) {
      this.element.innerHTML = `
  <div class="loading__wrapper">
    <span class="letter letter1">L</span>
    <span class="letter letter2">o</span>
    <span class="letter letter3">a</span>
    <span class="letter letter4">d</span>
    <span class="letter letter5">i</span>
    <span class="letter letter6">n</span>
    <span class="letter letter7">g</span>
    <span class="letter letter8">.</span>
    <span class="letter letter9">.</span>
    <span class="letter letter10">.</span>
  </div>

      `;
      return this.element;
    }
    this.element.classList.add("news-list");
    this.element.innerHTML = `
       <div class="news-list__title">
      Лента новостей
      <div class="title__date">${this.parentState.date}</div>
    </div>
    `;
    for (const cardState of this.parentState.list) {
      const newsCard = new NewsCard(this.appState, cardState).render();
      this.element.append(newsCard);
      // console.log(this.parentState);
      // console.log(this.appState);
    }
    return this.element;
  }
}
