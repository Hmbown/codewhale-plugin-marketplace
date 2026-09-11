#!/usr/bin/env python3
"""Codewhale parity native-app fixture (Tk, stdlib only).

Disposable desktop app with a menu bar, text entry, scrollable list, drag
canvas, modal dialog, second window and a Unicode label. Oracle: every state
change is written atomically to the JSON file given as argv[1] and mirrored
into the window title as "CU-NATIVE <json>". Geometry is fixed: 800x600 at
+0+0 (the runner may re-place it with wmctrl and reads the client origin).

Widget layout (client-relative centers):
  entry            (200, 40)     menubar: File > "Mark file" / "Quit"; Edit > "Mark edit"
  "Apply" button   (450, 40)     (menu bar itself is drawn by Tk at the top ~y=0..25)
  listbox          (20..380, 80..280), 40 rows of ~20px; selecting row 39 needs scrolling
  drag canvas      (420..780, 80..280); square starts centered (480,180); target zone x>=660
  "Open dialog"    (100, 330)    modal dialog centered on the app with an OK button
  "New window"     (300, 330)    opens a toplevel "CU-NATIVE-2" with one button "Second"
  unicode label    (200, 400)    shows the entry text verbatim after Apply
  select entry     (500, 400)    for select_text tests, prefilled "hello parity world"
"""
import json, os, sys, tempfile
import tkinter as tk
from tkinter import simpledialog

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), "cu-native-state.json")

state = {"entry": "", "applied": "", "menu": [], "selected": None, "square": [480, 180], "in_zone": False,
         "dialog": "closed", "dialog_result": None, "second_clicks": 0, "keys": [], "select": None,
         # Content origin of each window in screen coordinates. Tk knows this
         # exactly; a runner that measures it from outside has to guess where
         # the title bar and (on X11) the menubar child end.
         "origin": None, "origin2": None, "ver": 1}

root = tk.Tk()
root.title("CU-NATIVE {}")
root.geometry("800x600+0+0")
root.resizable(False, False)


def oracle():
    try:
        state["origin"] = [root.winfo_rootx(), root.winfo_rooty()]
    except tk.TclError:
        pass
    s = json.dumps(state, ensure_ascii=False)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(s)
    os.replace(tmp, OUT)
    root.title("CU-NATIVE " + s)


def mark(name):
    state["menu"].append(name)
    oracle()


menubar = tk.Menu(root)
filem = tk.Menu(menubar, tearoff=0)
filem.add_command(label="Mark file", command=lambda: mark("file"))
filem.add_command(label="Quit", command=root.destroy)
menubar.add_cascade(label="File", menu=filem)
editm = tk.Menu(menubar, tearoff=0)
editm.add_command(label="Mark edit", command=lambda: mark("edit"))
menubar.add_cascade(label="Edit", menu=editm)
root.config(menu=menubar)

entry_var = tk.StringVar()
entry = tk.Entry(root, textvariable=entry_var, font=("Sans", 14))
entry.place(x=20, y=20, width=360, height=40)
entry_var.trace_add("write", lambda *_: (state.__setitem__("entry", entry_var.get()), oracle()))


def apply():
    state["applied"] = entry_var.get()
    label.config(text=state["applied"] or "(empty)")
    oracle()


tk.Button(root, text="Apply", command=apply).place(x=400, y=20, width=100, height=40)

lb = tk.Listbox(root, font=("Sans", 12), exportselection=False)
lb.place(x=20, y=80, width=340, height=200)
sb = tk.Scrollbar(root, command=lb.yview)
sb.place(x=360, y=80, width=20, height=200)
lb.config(yscrollcommand=sb.set)
for i in range(40):
    lb.insert("end", f"item {i}")


def on_select(_):
    sel = lb.curselection()
    state["selected"] = int(sel[0]) if sel else None
    oracle()


lb.bind("<<ListboxSelect>>", on_select)

canvas = tk.Canvas(root, bg="#f4f4f4", highlightthickness=1, highlightbackground="#999")
canvas.place(x=420, y=80, width=360, height=200)
canvas.create_rectangle(240, 0, 360, 200, fill="#e0ecff", outline="")
canvas.create_text(300, 100, text="zone")
sq = canvas.create_rectangle(40, 80, 80, 120, fill="#fc6", outline="#963", width=2)
drag = {"x": 0, "y": 0}


def sq_center():
    x0, y0, x1, y1 = canvas.coords(sq)
    return [int((x0 + x1) / 2), int((y0 + y1) / 2)]


def down(e):
    drag["x"], drag["y"] = e.x, e.y


def move(e):
    canvas.move(sq, e.x - drag["x"], e.y - drag["y"])
    drag["x"], drag["y"] = e.x, e.y


def up(_):
    c = sq_center()
    state["square"] = [c[0] + 420, c[1] + 80]
    state["in_zone"] = c[0] >= 240
    oracle()


canvas.tag_bind(sq, "<ButtonPress-1>", down)
canvas.tag_bind(sq, "<B1-Motion>", move)
canvas.tag_bind(sq, "<ButtonRelease-1>", up)


def open_dialog():
    state["dialog"] = "open"
    oracle()
    r = simpledialog.askstring("CU-DIALOG", "Type something and press OK", parent=root)
    state["dialog"] = "closed"
    state["dialog_result"] = r
    oracle()


tk.Button(root, text="Open dialog", command=open_dialog).place(x=20, y=310, width=160, height=40)


def new_window():
    top = tk.Toplevel(root)
    top.title("CU-NATIVE-2")
    top.geometry("300x200+820+0")

    def hit():
        state["second_clicks"] += 1
        oracle()

    tk.Button(top, text="Second", command=hit).place(x=70, y=70, width=160, height=48)

    def report_origin():
        try:
            state["origin2"] = [top.winfo_rootx(), top.winfo_rooty()]
        except tk.TclError:
            return
        oracle()

    top.after(150, report_origin)


tk.Button(root, text="New window", command=new_window).place(x=220, y=310, width=160, height=40)

label = tk.Label(root, text="(empty)", font=("Sans", 14))
label.place(x=20, y=380, width=360, height=40)

sel_var = tk.StringVar(value="hello parity world")
sel_entry = tk.Entry(root, textvariable=sel_var, font=("Sans", 14))
sel_entry.place(x=400, y=380, width=200, height=40)


def report_selection(_=None):
    try:
        state["select"] = sel_entry.selection_get() if sel_entry.selection_present() else None
    except tk.TclError:
        state["select"] = None
    oracle()


sel_entry.bind("<<Selection>>", report_selection)
sel_entry.bind("<ButtonRelease-1>", report_selection)
sel_entry.bind("<KeyRelease>", report_selection)


def keys(e):
    mods = []
    if e.state & 0x4:
        mods.append("ctrl")
    if e.state & 0x8 or e.state & 0x80:
        mods.append("alt")
    if e.state & 0x1:
        mods.append("shift")
    state["keys"] = (state["keys"] + ["+".join(mods + [e.keysym])])[-8:]
    oracle()


entry.bind("<KeyPress>", keys, add="+")
# Tk's own modifier map differs per platform; let it name the macOS Command
# chord rather than decoding raw state bits here.
entry.bind("<Command-b>", lambda e: (state.__setitem__("keys", (state["keys"] + ["cmd+b"])[-8:]), oracle()), add="+")

oracle()
root.mainloop()
