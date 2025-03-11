// import onChange from "on-change";
import { AbstractView } from "../../common/view.js";
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
    // this.appState = onChange(this.appState, this.appStateHook.bind(this))
  }

  render() {
    const main = document.createElement("div");
    main.innerHTML = "123";
    this.app.innerHTML = "";
    this.app.append(main);
  }
}
