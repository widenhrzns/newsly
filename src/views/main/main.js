import onChange from "on-change";
import { Temporal } from "temporal-polyfill";
import { AbstractView } from "../../common/view.js";
import { Header } from "../../components/header/header.js";
import { NewsList } from "../../components/news-list/news-list.js";
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
    this.state = onChange(this.state, this.stateHook.bind(this));
    this.loadList();
  }

  appStateHook(path) {
    if (path === "readLater") {
      this.render();
    }
  }

  stateHook(path) {
    if (path === "list" || path === "loading") {
      setTimeout(() => {
        this.render();
      }, 2000);
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
      this.state.loading = false;
      if (data.status !== "ok") {
        throw new Error("Не удалось загрузить ленту");
      }
      this.state.totalResults = data.totalResults;
      this.state.list = data.articles;
    } catch (error) {
      console.warn(error);
    }
  }

  render() {
    const main = document.createElement("div");
    main.append(new NewsList(this.appState, this.state).render());

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
