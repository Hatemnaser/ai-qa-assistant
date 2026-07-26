import auth from "./auth.json";
import chat from "./chat.json";
import common from "./common.json";
import memory from "./memory.json";
import navigation from "./navigation.json";
import projects from "./projects.json";
import portability from "./portability.json";
import settings from "./settings.json";
import usage from "./usage.json";
import { mergeMessageCatalogs } from "../mergeMessageCatalogs";

const en = mergeMessageCatalogs(
  common,
  auth,
  navigation,
  chat,
  settings,
  memory,
  usage,
  projects,
  portability
);

export default en;
