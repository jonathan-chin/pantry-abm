// A small min-heap: pop() returns the item with the lowest key.
export class MinHeap {
  constructor() { this.keys = []; this.items = []; }
  get size() { return this.keys.length; }
  peekKey() { return this.keys[0]; }

  push(key, item) {
    const { keys, items } = this;
    let i = keys.length;
    keys.push(key); items.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= keys[i]) break;
      [keys[p], keys[i]] = [keys[i], keys[p]];
      [items[p], items[i]] = [items[i], items[p]];
      i = p;
    }
  }

  pop() {
    const { keys, items } = this;
    const top = items[0];
    const lastKey = keys.pop(), lastItem = items.pop();
    const n = keys.length;
    if (n > 0) {
      keys[0] = lastKey; items[0] = lastItem;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < n && keys[l] < keys[m]) m = l;
        if (r < n && keys[r] < keys[m]) m = r;
        if (m === i) break;
        [keys[m], keys[i]] = [keys[i], keys[m]];
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top;
  }
}
