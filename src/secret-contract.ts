import { createSimpleChannelSecretContract } from "openclaw/plugin-sdk/channel-secret-basic-runtime";

export const channelSecrets = createSimpleChannelSecretContract({
  channelKey: "dingtalk-connector",
  label: "DingTalk",
  accountFields: ["clientSecret"],
  channelFields: ["clientSecret"],
  mode: "account-inheritance",
});

export const {
  secretTargetRegistryEntries,
  collectRuntimeConfigAssignments,
} = channelSecrets;
