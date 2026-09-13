// Test-only actuator for the deliberate-switch trial. This is independent of
// the Computer Use runtime and can activate only the runner's owned decoy.
#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>

int main(int argc, const char **argv) { @autoreleasepool {
  if (argc != 3) return 2;
  NSString *bundle = [NSString stringWithUTF8String:argv[2]];
  if (![bundle hasPrefix:@"net.codewhale.parity.decoy."]) return 2;
  NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:atoi(argv[1])];
  if (!app || ![app.bundleIdentifier isEqualToString:bundle]) return 2;
  AXUIElementRef element = AXUIElementCreateApplication(app.processIdentifier);
  AXError error = AXUIElementSetAttributeValue(element, kAXFrontmostAttribute, kCFBooleanTrue);
  CFRelease(element);
  if (error != kAXErrorSuccess) {
    fprintf(stderr, "Owned decoy activation failed (AX error %d); the test host needs Accessibility permission.\n", error);
    return 1;
  }
} return 0; }
