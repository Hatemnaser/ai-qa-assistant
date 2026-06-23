import en from "./en";

export type MessageKey = keyof typeof en;
export type MessageMap = Record<MessageKey, string>;
export type TranslationKey = MessageKey;
