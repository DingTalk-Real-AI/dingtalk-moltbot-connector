import { createPluginRuntimeStore, type PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setDingtalkRuntime, getRuntime: getDingtalkRuntime } =
  createPluginRuntimeStore<PluginRuntime>("DingTalk runtime not initialized");

export { getDingtalkRuntime, setDingtalkRuntime };
