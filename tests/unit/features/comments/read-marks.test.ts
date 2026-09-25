import { readMarkKey } from "@/features/comments/inbox-model";
import { READ_MARKS_KEY, type ReadMarksStorage,ReadMarksStore } from "@/features/comments/read-marks";

class FakeStorage implements ReadMarksStorage {
  saves = 0;
  constructor(private value: unknown = undefined) {}

  load(key: string): unknown {
    return key === READ_MARKS_KEY ? this.value : undefined;
  }

  save(key: string, value: unknown): void {
    if (key !== READ_MARKS_KEY) return;
    this.saves++;
    this.value = value;
  }

  raw(): unknown {
    return this.value;
  }
}

describe("read marks store", () => {
  it("starts empty when nothing has been stored", () => {
    const store = new ReadMarksStore(new FakeStorage());
    expect(store.marks().size).toBe(0);
  });

  it("keeps only numeric marks out of stored data", () => {
    const storage = new FakeStorage({
      [readMarkKey("A.md", "a")]: 1000,
      [readMarkKey("B.md", "b")]: "not a time",
      [readMarkKey("C.md", "c")]: null,
    });

    const marks = new ReadMarksStore(storage).marks();

    expect([...marks.entries()]).toEqual([[readMarkKey("A.md", "a"), 1000]]);
  });

  it("survives stored data that is not an object at all", () => {
    expect(new ReadMarksStore(new FakeStorage("wrecked")).marks().size).toBe(0);
    expect(new ReadMarksStore(new FakeStorage([1, 2])).marks().size).toBe(0);
  });

  it("records a mark and writes it through", () => {
    const storage = new FakeStorage();
    const store = new ReadMarksStore(storage);

    store.markRead("A.md", "a", 1200);

    expect(store.marks().get(readMarkKey("A.md", "a"))).toBe(1200);
    expect(storage.raw()).toEqual({ [readMarkKey("A.md", "a")]: 1200 });
  });

  it("never moves a mark backwards", () => {
    const store = new ReadMarksStore(new FakeStorage());
    store.markRead("A.md", "a", 1200);

    store.markRead("A.md", "a", 900);

    expect(store.marks().get(readMarkKey("A.md", "a"))).toBe(1200);
  });

  it("marks a batch in one write", () => {
    const storage = new FakeStorage();
    const store = new ReadMarksStore(storage);

    store.markAllRead([
      { filePath: "A.md", id: "a", at: 10 },
      { filePath: "B.md", id: "b", at: 20 },
    ]);

    expect(storage.saves).toBe(1);
    expect(store.marks().size).toBe(2);
  });

  it("follows a renamed file so its threads do not all reappear as unread", () => {
    const storage = new FakeStorage();
    const store = new ReadMarksStore(storage);
    store.markRead("Old.md", "a", 10);

    store.rename("Old.md", "New.md");

    expect(store.marks().get(readMarkKey("New.md", "a"))).toBe(10);
    expect(store.marks().has(readMarkKey("Old.md", "a"))).toBe(false);
  });

  it("prunes marks for files the vault no longer indexes", () => {
    const storage = new FakeStorage();
    const store = new ReadMarksStore(storage);
    store.markAllRead([
      { filePath: "Live.md", id: "a", at: 10 },
      { filePath: "Dead.md", id: "b", at: 20 },
    ]);

    store.prune(new Set(["Live.md"]));

    expect([...store.marks().keys()]).toEqual([readMarkKey("Live.md", "a")]);
  });

  it("does not write when pruning changes nothing", () => {
    const storage = new FakeStorage();
    const store = new ReadMarksStore(storage);
    store.markRead("Live.md", "a", 10);
    const before = storage.saves;

    store.prune(new Set(["Live.md"]));

    expect(storage.saves).toBe(before);
  });
});
