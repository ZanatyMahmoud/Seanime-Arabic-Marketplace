interface DocSelection {
  length: number;
  find(selector: string): DocSelection;
  attr(name: string): string | undefined;
  text(): string;
  each(callback: (index: number, element: DocSelection) => void): void;
  map<T>(callback: (index: number, element: DocSelection) => T): T[];
  first(): DocSelection;
  eq(index: number): DocSelection;
}

type DocSelectionFunction = (selector: string) => DocSelection;
declare function LoadDoc(html: string): DocSelectionFunction;
declare function $sleep(milliseconds: number): Promise<void>;

declare const $store: {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete?(key: string): void;
};
