// import onChange from "on-change";
import onChange from "on-change";
import { AbstractView } from "../../common/view.js";
import { Header } from "../../components/header/header.js";
import "./main.css";

export class MainView extends AbstractView {
  state = {
    list: [],
    numFound: 0,
    loading: false,
    searchQuery: undefined,
    offset: 0,
  };

  constructor(appState) {
    super();
    this.appState = appState;
    this.setTitle("Newsly - лента новостей");
    this.appState = onChange(this.appState, this.appStateHook.bind(this));
  }

  appStateHook(path) {
    if (path === "readLater") {
      console.log(path);
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
