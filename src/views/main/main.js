import onChange from "on-change";
import { Temporal } from "temporal-polyfill";
import { AbstractView } from "../../common/view.js";
import { Header } from "../../components/header/header.js";
import "./main.css";

export class MainView extends AbstractView {
  state = {
    list: [],
    totalResults: 0,
    loading: false,
    searchQuery: undefined,
    offset: 0,
    date: Temporal.Now.plainDateISO().subtract({ days: 1 }).toString(),
  };

  constructor(appState) {
    super();
    this.appState = appState;
    this.setTitle("Newsly - лента новостей");
    this.appState = onChange(this.appState, this.appStateHook.bind(this));
    this.loadList();
  }

  appStateHook(path) {
    if (path === "readLater") {
      this.render();
    }
  }

  async getNews() {
    const response = await fetch(
      `https://newsapi.org/v2/everything?q=а&language=ru&from=2025-03-16&apiKey=51e43ca151254a9987a83b9d0530ebd6`
    );
    return response.json();
  }

  async loadList() {
    try {
      this.state.loading = true;
      const data = await this.getNews();
      if (data.status !== "ok") {
        throw new Error("Не удалось загрузить ленту");
      }
      this.state.loading = false;
      this.state.list = data.articles;
    } catch (error) {
      console.warn(error);
    }
  }

  render() {
    const main = document.createElement("div");

    this.app.innerHTML = "";
    this.app.append(main);
    this.renderHeader();
    // this.appState.readLater.push("123");
  }

  renderHeader() {
    const header = new Header(this.appState).render();
    this.app.prepend(header);
  }
}
