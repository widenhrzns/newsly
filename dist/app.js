(function () {
  'use strict';

  class AbstractView {
    constructor() {
      this.app = document.getElementById("root");
    }

    setTitle(title) {
      document.title = title;
    }

    render() {
      return;
    }

    destroy() {
      return;
    }
  }

  // import onChange from "on-change";

  class MainView extends AbstractView {
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

  class App {
    routes = [{ path: "", view: MainView }];
    appState = {
      readLater: [],
    };

    constructor() {
      window.addEventListener("hashchange", this.render.bind(this));
      this.render();
    }

    render() {
      if (this.currentView) {
        this.currentView.destroy();
      }
      const view = this.routes.find((route) => route.path === location.hash).view;
      this.currentView = new view(this.appState);
      this.currentView.render();
    }
  }

  new App();

})();
