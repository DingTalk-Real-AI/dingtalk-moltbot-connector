import { createPluginRuntimeStore, type PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setDingtalkRuntime, getRuntime: getDingtalkRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "dingtalk-connector",
    errorMessage: "DingTalk runtime not initialized",
  });

export { getDingtalkRuntime, setDingtalkRuntime };
