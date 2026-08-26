import "bootstrap/dist/css/bootstrap.min.css";
// Oddpath uses Bootstrap's dropdown behavior only. Importing the complete
// bundle also shipped unused modal, carousel, tooltip, toast, and collapse JS.
import "bootstrap/js/dist/dropdown";
import "./styles/main.scss";

import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#app");
