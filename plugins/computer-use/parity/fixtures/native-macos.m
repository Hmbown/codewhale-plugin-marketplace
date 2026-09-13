// Codewhale parity native-app fixture for macOS (AppKit, no dependencies).
//
// Same contract and the same client-relative geometry as fixtures/native.py,
// so parity/tasks.darwin.json reuses the Tk suite's coordinates unchanged.
// Oracle: every state change is written atomically to the JSON file given as
// argv[1]; the runner reads that file and never asks the tool surface.
//
// Why not Tk here: Tk/Aqua does not consume CGEvents posted to its process
// (measured — see docs/LIMITATIONS.md), so it cannot tell "the agent's input
// failed" apart from "this toolkit ignores process-scoped input". A plain
// AppKit app is what a macOS application actually is.
//
// Widget layout (client-relative centres, content area is 800x600):
//   entry            (200, 40)      "Apply" button   (450, 40)
//   listbox          (20..380, 80..280), 40 rows of 20px
//   drag canvas      (420..780, 80..280); square centred (480,180); zone x>=660
//   "Open dialog"    (100, 330)     "New window"     (300, 330)
//   unicode label    (200, 400)     select entry     (500, 400)
#import <Cocoa/Cocoa.h>

static NSString *gOut = nil;
static NSMutableDictionary *gState = nil;
static NSWindow *gWindow = nil, *gSecond = nil;
static NSView *gContent = nil;
static NSTextField *gEntry = nil, *gLabel = nil, *gSelect = nil;
static NSTableView *gTable = nil;

/** Top-left of a window's content area in global, y-down screen points — the
 *  same space CGEvent and screencapture use. */
static NSArray *contentOrigin(NSWindow *w) {
  if (!w) return nil;
  NSRect content = [w contentRectForFrameRect:w.frame];
  CGFloat screenTop = NSMaxY(NSScreen.screens.firstObject.frame);
  return @[@((NSInteger)llround(NSMinX(content))), @((NSInteger)llround(screenTop - NSMaxY(content)))];
}

static void writeState(void) {
  gState[@"origin"] = contentOrigin(gWindow) ?: NSNull.null;
  gState[@"origin2"] = contentOrigin(gSecond) ?: NSNull.null;
  NSData *data = [NSJSONSerialization dataWithJSONObject:gState options:0 error:nil];
  if (!data) return;
  NSString *tmp = [gOut stringByAppendingString:@".tmp"];
  if ([data writeToFile:tmp atomically:NO]) {
    [NSFileManager.defaultManager removeItemAtPath:gOut error:nil];
    [NSFileManager.defaultManager moveItemAtPath:tmp toPath:gOut error:nil];
  }
}

static void pushKey(NSString *chord) {
  NSMutableArray *keys = [gState[@"keys"] mutableCopy];
  [keys addObject:chord];
  while (keys.count > 8) [keys removeObjectAtIndex:0];
  gState[@"keys"] = keys;
  writeState();
}

// ---------- drag canvas ----------
@interface CanvasView : NSView
@property NSPoint square;   // centre, canvas-local, top-left origin
@property BOOL dragging;
@end

@implementation CanvasView
- (BOOL)isFlipped { return YES; }
- (void)drawRect:(NSRect)dirty {
  [[NSColor colorWithWhite:0.96 alpha:1] setFill];
  NSRectFill(self.bounds);
  [[NSColor colorWithRed:0.88 green:0.93 blue:1 alpha:1] setFill];
  NSRectFill(NSMakeRect(240, 0, 120, 200));
  [[NSColor colorWithRed:1 green:0.8 blue:0.4 alpha:1] setFill];
  NSRectFill(NSMakeRect(self.square.x - 20, self.square.y - 20, 40, 40));
  [[NSColor colorWithWhite:0.6 alpha:1] setStroke];
  NSFrameRect(self.bounds);
}
// Report what the toolkit actually received, so a failed gesture can be told
// apart from an undelivered one.
static void countEvent(NSString *kind) {
  NSMutableDictionary *seen = [gState[@"mouse_events"] mutableCopy] ?: [NSMutableDictionary dictionary];
  seen[kind] = @([seen[kind] integerValue] + 1);
  gState[@"mouse_events"] = seen;
  writeState();
}
- (BOOL)acceptsFirstMouse:(NSEvent *)e { return NO; }   // ordinary AppKit behaviour
- (void)mouseDown:(NSEvent *)e {
  countEvent(@"down");
  NSPoint p = [self convertPoint:e.locationInWindow fromView:nil];
  self.dragging = fabs(p.x - self.square.x) <= 20 && fabs(p.y - self.square.y) <= 20;
}
- (void)mouseDragged:(NSEvent *)e {
  countEvent(@"dragged");
  if (!self.dragging) return;
  self.square = [self convertPoint:e.locationInWindow fromView:nil];
  self.needsDisplay = YES;
}
- (void)mouseUp:(NSEvent *)e {
  countEvent(@"up");
  if (!self.dragging) return;
  self.dragging = NO;
  gState[@"square"] = @[@((NSInteger)llround(self.square.x + 420)), @((NSInteger)llround(self.square.y + 80))];
  // @(expr) on a comparison yields a plain number, which JSON-encodes as 1/0;
  // the oracle compares against true.
  gState[@"in_zone"] = self.square.x >= 240 ? @YES : @NO;
  writeState();
}
@end

// ---------- controller ----------
@interface Fixture : NSObject <NSTableViewDataSource, NSTableViewDelegate, NSTextFieldDelegate>
@property NSWindow *sheet;
@property NSTextField *sheetField;
@end

@implementation Fixture
- (void)markFile:(id)sender {
  gState[@"menu"] = [gState[@"menu"] arrayByAddingObject:@"file"];
  writeState();
}

- (void)apply:(id)sender {
  gState[@"applied"] = gEntry.stringValue ?: @"";
  gLabel.stringValue = gEntry.stringValue.length ? gEntry.stringValue : @"(empty)";
  writeState();
}

- (void)controlTextDidChange:(NSNotification *)note {
  if (note.object == gEntry) { gState[@"entry"] = gEntry.stringValue ?: @""; writeState(); }
}

- (NSInteger)numberOfRowsInTableView:(NSTableView *)t { return 40; }
- (id)tableView:(NSTableView *)t objectValueForTableColumn:(NSTableColumn *)c row:(NSInteger)row {
  return [NSString stringWithFormat:@"item %ld", (long)row];
}
- (void)tableViewSelectionDidChange:(NSNotification *)note {
  NSInteger row = gTable.selectedRow;
  gState[@"selected"] = row < 0 ? (id)NSNull.null : @(row);
  writeState();
}

- (void)openDialog:(id)sender {
  gState[@"dialog"] = @"open";
  gState[@"dialog_result"] = NSNull.null;
  writeState();
  NSWindow *sheet = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 360, 120)
    styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  sheet.title = @"CU-DIALOG";
  NSTextField *field = [[NSTextField alloc] initWithFrame:NSMakeRect(20, 60, 320, 28)];
  NSButton *ok = [NSButton buttonWithTitle:@"OK" target:self action:@selector(closeDialog:)];
  ok.frame = NSMakeRect(240, 16, 100, 32);
  ok.keyEquivalent = @"\r";
  field.target = self;
  field.action = @selector(closeDialog:);
  [sheet.contentView addSubview:field];
  [sheet.contentView addSubview:ok];
  self.sheet = sheet;
  self.sheetField = field;
  [gWindow beginSheet:sheet completionHandler:nil];
  [sheet makeFirstResponder:field];
}

- (void)closeDialog:(id)sender {
  if (!self.sheet) return;
  gState[@"dialog_result"] = self.sheetField.stringValue ?: @"";
  gState[@"dialog"] = @"closed";
  [gWindow endSheet:self.sheet];
  [self.sheet orderOut:nil];
  self.sheet = nil;
  self.sheetField = nil;
  writeState();
}

- (void)newWindow:(id)sender {
  if (gSecond) { [gSecond makeKeyAndOrderFront:nil]; return; }
  NSRect frame = NSMakeRect(NSMaxX(gWindow.frame) + 20, NSMinY(gWindow.frame) + 200, 300, 200);
  gSecond = [[NSWindow alloc] initWithContentRect:frame
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
  gSecond.title = @"CU-NATIVE-2";
  gSecond.releasedWhenClosed = NO;
  NSView *flipped = [[CanvasView alloc] initWithFrame:NSMakeRect(0, 0, 300, 200)];
  ((CanvasView *)flipped).square = NSMakePoint(-100, -100);   // no square in this window
  gSecond.contentView = flipped;
  NSButton *b = [NSButton buttonWithTitle:@"Second" target:self action:@selector(secondClick:)];
  b.frame = NSMakeRect(70, 70, 160, 48);
  [flipped addSubview:b];
  [gSecond orderFrontRegardless];
  writeState();
}

- (void)secondClick:(id)sender {
  gState[@"second_clicks"] = @([gState[@"second_clicks"] integerValue] + 1);
  writeState();
}

/** Selection and geometry have no notification worth trusting across an
 *  external click, so they are sampled. */
- (void)sample:(NSTimer *)t {
  id current = NSNull.null;
  NSText *editor = [gSelect currentEditor];
  if ([editor isKindOfClass:NSTextView.class]) {
    NSRange r = ((NSTextView *)editor).selectedRange;
    if (r.length > 0) current = [((NSTextView *)editor).string substringWithRange:r];
  }
  BOOL changed = ![current isEqual:gState[@"select"]];
  NSNumber *top = @((NSInteger)llround(gTable.enclosingScrollView.contentView.bounds.origin.y / 20));
  if (![top isEqual:gState[@"scroll_top"]]) { gState[@"scroll_top"] = top; changed = YES; }
  NSArray *origin = contentOrigin(gWindow), *origin2 = contentOrigin(gSecond);
  if (![origin isEqual:gState[@"origin"]] || (origin2 && ![origin2 isEqual:gState[@"origin2"]])) changed = YES;
  if (!changed) return;
  gState[@"select"] = current;
  writeState();
}
@end

// ---------- layout ----------
static NSTextField *field(NSRect r, NSString *value) {
  NSTextField *f = [[NSTextField alloc] initWithFrame:r];
  f.stringValue = value ?: @"";
  f.font = [NSFont systemFontOfSize:14];
  return f;
}

int main(int argc, const char **argv) { @autoreleasepool {
  if (argc < 2) { fprintf(stderr, "usage: native-macos <state.json>\n"); return 2; }
  gOut = [NSString stringWithUTF8String:argv[1]];
  gState = [@{ @"entry": @"", @"applied": @"", @"menu": @[], @"selected": NSNull.null,
               @"square": @[@480, @180], @"in_zone": @NO, @"dialog": @"closed",
               @"dialog_result": NSNull.null, @"second_clicks": @0, @"keys": @[],
               @"select": NSNull.null, @"scroll_top": @0, @"mouse_events": @{}, @"origin": NSNull.null, @"origin2": NSNull.null,
               @"key_down_count": @0, @"key_up_count": @0, @"keys_up": @[],
               @"pid": @(NSProcessInfo.processInfo.processIdentifier), @"ver": @1 } mutableCopy];
  NSString *entry = @"";
  for (int i=2; i<argc; i++) {
    if (strcmp(argv[i],"--entry")==0 && i+1<argc) entry=[NSString stringWithUTF8String:argv[++i]];
  }

  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  Fixture *fx = [Fixture new];
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Main"];
  NSMenuItem *appItem = [[NSMenuItem alloc] initWithTitle:@"Fixture" action:nil keyEquivalent:@""];
  appItem.submenu = [[NSMenu alloc] initWithTitle:@"Fixture"];
  [menu addItem:appItem];
  NSMenuItem *fileItem = [[NSMenuItem alloc] initWithTitle:@"File" action:nil keyEquivalent:@""];
  NSMenu *fileMenu = [[NSMenu alloc] initWithTitle:@"File"];
  NSMenuItem *mark = [[NSMenuItem alloc] initWithTitle:@"Mark file" action:@selector(markFile:) keyEquivalent:@""];
  mark.target = fx;
  [fileMenu addItem:mark];
  fileItem.submenu = fileMenu;
  [menu addItem:fileItem];
  NSApp.mainMenu = menu;

  // Place the content area near the top of the main screen in y-down terms, so
  // the whole 800x600 fixture is on screen and clear of the menu bar.
  CGFloat screenTop = NSMaxY(NSScreen.screens.firstObject.frame);
  NSRect frame = NSMakeRect(60, screenTop - 100 - 600, 800, 600);
  gWindow = [[NSWindow alloc] initWithContentRect:frame
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
  gWindow.title = @"CU-NATIVE";
  gWindow.releasedWhenClosed = NO;

  // A flipped container makes every frame below top-left relative, so the
  // numbers match the Tk fixture (and therefore the shared task coordinates).
  CanvasView *root = [[CanvasView alloc] initWithFrame:NSMakeRect(0, 0, 800, 600)];
  root.square = NSMakePoint(-100, -100);
  gContent = root;
  gWindow.contentView = root;

  gEntry = field(NSMakeRect(20, 20, 360, 40), entry);
  gState[@"entry"] = entry;
  gEntry.delegate = fx;
  [root addSubview:gEntry];

  NSButton *applyBtn = [NSButton buttonWithTitle:@"Apply" target:fx action:@selector(apply:)];
  applyBtn.frame = NSMakeRect(400, 20, 100, 40);
  [root addSubview:applyBtn];

  NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(20, 80, 340, 200)];
  scroll.hasVerticalScroller = YES;
  scroll.borderType = NSBezelBorder;
  gTable = [[NSTableView alloc] initWithFrame:scroll.bounds];
  NSTableColumn *col = [[NSTableColumn alloc] initWithIdentifier:@"item"];
  col.width = 300;
  [gTable addTableColumn:col];
  gTable.headerView = nil;
  gTable.rowHeight = 20;
  gTable.usesAlternatingRowBackgroundColors = YES;
  gTable.dataSource = fx;
  gTable.delegate = fx;
  scroll.documentView = gTable;
  [root addSubview:scroll];

  CanvasView *canvas = [[CanvasView alloc] initWithFrame:NSMakeRect(420, 80, 360, 200)];
  canvas.square = NSMakePoint(60, 100);   // client centre (480, 180)
  [root addSubview:canvas];

  NSButton *dialogBtn = [NSButton buttonWithTitle:@"Open dialog" target:fx action:@selector(openDialog:)];
  dialogBtn.frame = NSMakeRect(20, 310, 160, 40);
  [root addSubview:dialogBtn];

  NSButton *windowBtn = [NSButton buttonWithTitle:@"New window" target:fx action:@selector(newWindow:)];
  windowBtn.frame = NSMakeRect(220, 310, 160, 40);
  [root addSubview:windowBtn];

  gLabel = field(NSMakeRect(20, 380, 360, 40), @"(empty)");
  gLabel.editable = NO;
  gLabel.bezeled = NO;
  gLabel.drawsBackground = NO;
  [root addSubview:gLabel];

  gSelect = field(NSMakeRect(400, 380, 200, 40), @"hello parity world");
  [root addSubview:gSelect];

  // One monitor sees every key the app receives, whichever control has focus.
  [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown | NSEventMaskKeyUp handler:^NSEvent *(NSEvent *e) {
    NSMutableArray *parts = [NSMutableArray array];
    if (e.modifierFlags & NSEventModifierFlagControl) [parts addObject:@"ctrl"];
    if (e.modifierFlags & NSEventModifierFlagOption) [parts addObject:@"alt"];
    if (e.modifierFlags & NSEventModifierFlagShift) [parts addObject:@"shift"];
    if (e.modifierFlags & NSEventModifierFlagCommand) [parts addObject:@"cmd"];
    NSString *key = e.charactersIgnoringModifiers ?: @"";
    if (e.keyCode == 36) key = @"Return";
    else if (e.keyCode == 53) key = @"Escape";
    [parts addObject:key];
    NSString *chord=[parts componentsJoinedByString:@"+"];
    if (e.type==NSEventTypeKeyUp) {
      gState[@"key_up_count"]=@([gState[@"key_up_count"] integerValue]+1);
      NSArray *keys=[gState[@"keys_up"] arrayByAddingObject:chord];
      gState[@"keys_up"]=keys.count>8?[keys subarrayWithRange:NSMakeRange(keys.count-8,8)]:keys;
      writeState();
    } else {
      gState[@"key_down_count"]=@([gState[@"key_down_count"] integerValue]+1);
      pushKey(chord);
    }
    return e;
  }];

  [NSTimer scheduledTimerWithTimeInterval:0.15 target:fx selector:@selector(sample:) userInfo:nil repeats:YES];

  // orderFrontRegardless, never activate: the window has to sit above other
  // applications' windows so coordinate targets actually land on it, but the
  // fixture must not take the user's foreground — that is the property the
  // parity run measures.
  if(argc>2 && strcmp(argv[2],"--background")==0) [gWindow orderBack:nil];
  else [gWindow orderFrontRegardless];
  writeState();
  [NSApp run];
} return 0; }
