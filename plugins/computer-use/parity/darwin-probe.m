// Independent desktop probe for the macOS parity runner.
//
// Interference numbers must not come from the software under test, so this
// reads the pointer, the frontmost application and the main display through
// public CoreGraphics/AppKit calls that need no TCC grant and share no code
// with src/backends/darwin*. Prints one JSON line.
#import <Cocoa/Cocoa.h>

int main(void) { @autoreleasepool {
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
} return 0; }
