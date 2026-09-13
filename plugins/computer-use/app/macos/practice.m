// An owned, disposable AppKit surface for the setup check. No user files,
// clipboard, activation or shared-pointer writes. stdout is its own oracle.
#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>

@interface CUPractice : NSObject <NSApplicationDelegate>
@property NSWindow *window;
@property NSTextField *entry;
@property NSTextField *result;
@property CGPoint initialPointer;
@property pid_t initialForeground;
@property NSUInteger samples;
@property NSUInteger pointerChanges;
@property NSUInteger foregroundChanges;
@end
@implementation CUPractice
- (void)emit:(NSString *)event {
  NSDictionary *data=@{@"event":event,@"value":self.result.stringValue?:@"",@"samples":@(self.samples),@"pointerChanges":@(self.pointerChanges),@"foregroundChanges":@(self.foregroundChanges)};
  NSData *json=[NSJSONSerialization dataWithJSONObject:data options:0 error:nil];
  fwrite(json.bytes,1,json.length,stdout); fputc('\n',stdout); fflush(stdout);
}
- (void)sample:(NSTimer *)timer {
  CGEventRef event=CGEventCreate(NULL); CGPoint point=CGEventGetLocation(event); CFRelease(event);
  if(!CGPointEqualToPoint(point,self.initialPointer)) self.pointerChanges++;
  if(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier!=self.initialForeground) self.foregroundChanges++;
  self.samples++;
  if(self.samples%10==0) [self emit:@"sample"];
}
- (void)apply:(id)sender {
  self.result.stringValue=self.entry.stringValue;
  [self emit:@"applied"];
}
- (void)applicationDidFinishLaunching:(NSNotification *)note {
  self.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(120,120,460,240) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  self.window.title=@"Codewhale practice window";
  NSView *view=self.window.contentView;
  NSTextField *title=[NSTextField labelWithString:@"A small background check"];
  title.font=[NSFont systemFontOfSize:20 weight:NSFontWeightSemibold]; title.frame=NSMakeRect(24,175,410,32); [view addSubview:title];
  NSTextField *hint=[NSTextField wrappingLabelWithString:@"Codewhale will enter a short phrase and press Apply here."];
  hint.frame=NSMakeRect(24,130,410,40); hint.textColor=NSColor.secondaryLabelColor; [view addSubview:hint];
  self.entry=[[NSTextField alloc] initWithFrame:NSMakeRect(24,88,300,28)];
  self.entry.accessibilityLabel=@"Practice text"; [view addSubview:self.entry];
  NSButton *button=[NSButton buttonWithTitle:@"Apply" target:self action:@selector(apply:)];
  button.bezelStyle=NSBezelStyleRounded; button.frame=NSMakeRect(336,85,100,32); [view addSubview:button];
  self.result=[NSTextField labelWithString:@"Waiting for Codewhale"];
  self.result.frame=NSMakeRect(24,35,412,30); self.result.accessibilityLabel=@"Observed result"; [view addSubview:self.result];
  // Order behind the person's current work, without making a key window.
  [self.window orderBack:nil];
  CGEventRef event=CGEventCreate(NULL); self.initialPointer=CGEventGetLocation(event); CFRelease(event);
  self.initialForeground=NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
  [NSTimer scheduledTimerWithTimeInterval:0.01 target:self selector:@selector(sample:) userInfo:nil repeats:YES];
  [self emit:@"ready"];
}
@end
int main(void) { @autoreleasepool {
  [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  CUPractice *delegate=[CUPractice new]; NSApp.delegate=delegate; [NSApp run];
} return 0; }
