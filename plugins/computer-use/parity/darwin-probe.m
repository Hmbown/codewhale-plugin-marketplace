// Independent desktop probe for the macOS parity runner.
//
// Interference numbers must not come from the software under test, so this
// reads the pointer, the frontmost application and the main display through
// public CoreGraphics/AppKit calls that need no TCC grant and share no code
// with src/backends/darwin*. Prints one JSON line.
#import <Cocoa/Cocoa.h>

int main(int argc, const char **argv) {
  // --restore-focus <pid>: hand foreground activation back to an app that was
  // frontmost before a fixture launch stole it. Polite activation only; needs
  // no TCC grant and never touches the pointer.
  if (argc >= 3 && strcmp(argv[1], "--restore-focus") == 0) { @autoreleasepool {
    pid_t pid = (pid_t)atoi(argv[2]);
    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    if (app && !app.terminated) [app activateWithOptions:0];
  } return 0; }
  do { @autoreleasepool {
  CGEventRef event = CGEventCreate(NULL);
  CGPoint p = CGEventGetLocation(event);
  CFRelease(event);

  NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;

  CGDirectDisplayID main = CGMainDisplayID();
  CGRect bounds = CGDisplayBounds(main);
  CGDisplayModeRef mode = CGDisplayCopyDisplayMode(main);
  size_t pw = CGDisplayModeGetPixelWidth(mode), ph = CGDisplayModeGetPixelHeight(mode);
  CGDisplayModeRelease(mode);

  NSDictionary *out = @{
    @"pointer": @{ @"x": @(p.x), @"y": @(p.y) },
    @"frontmost": front.bundleIdentifier ?: front.localizedName ?: @"",
    @"frontmost_name": front.localizedName ?: @"",
    @"frontmost_pid": @(front ? front.processIdentifier : -1),
    @"display": @{
      @"points": @{ @"w": @(bounds.size.width), @"h": @(bounds.size.height) },
      @"pixels": @{ @"w": @(pw), @"h": @(ph) },
      @"scale": @(pw / bounds.size.width),
    },
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
  puts([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
  fflush(stdout);
} if(argc<2 || strcmp(argv[1],"--watch")!=0) break;
  // NSWorkspace refreshes its application state through run-loop notifications.
  // Sleeping without servicing them can report the initial foreground forever.
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
} while(1); return 0; }
