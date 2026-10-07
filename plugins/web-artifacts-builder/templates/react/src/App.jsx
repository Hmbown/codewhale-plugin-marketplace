import { useState } from "react";

const START = [
  { id: 1, text: "Run npm run build", done: true },
  { id: 2, text: "Open dist/index.html", done: false },
];

export default function App() {
  const [items, setItems] = useState(START);
  const [draft, setDraft] = useState("");
  const left = items.filter((item) => !item.done).length;

  function add(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setItems([...items, { id: Date.now(), text, done: false }]);
    setDraft("");
  }

  function toggle(id) {
    setItems(items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)));
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-8 text-stone-900 dark:text-stone-100">
      <h1 className="text-3xl font-semibold tracking-tight">{{TITLE}}</h1>
      <p className="mb-6 mt-1 text-stone-600 dark:text-stone-400">
        Replace this starter with your page. The build inlines everything into one file.
      </p>
      <form onSubmit={add} className="mb-4 flex gap-2">
        <label htmlFor="item" className="sr-only">
          New item
        </label>
        <input
          id="item"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add an item"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-900"
        />
        <button className="rounded-lg bg-teal-700 px-4 py-2 text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
          Add
        </button>
      </form>
      <ul className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-3">
            <input
              id={`item-${item.id}`}
              type="checkbox"
              checked={item.done}
              onChange={() => toggle(item.id)}
            />
            <label
              htmlFor={`item-${item.id}`}
              className={item.done ? "text-stone-500 line-through" : ""}
            >
              {item.text}
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-stone-600 dark:text-stone-400" aria-live="polite">
        {left} of {items.length} remaining
      </p>
    </main>
  );
}
