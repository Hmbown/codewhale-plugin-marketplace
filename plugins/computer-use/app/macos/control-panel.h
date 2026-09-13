// Native setup and safety controls. Commands travel only over the inherited
// parent/child socketpair; they are deliberately absent from the MCP surface.
#include <sys/socket.h>

static int cuControlFD=-1;
static NSMutableData *cuControlBuffer;
static void cuSend(NSString *command) {
  if(cuControlFD<0) return;
  NSData *data=[[NSString stringWithFormat:@"{\"command\":\"%@\"}\n",command] dataUsingEncoding:NSUTF8StringEncoding];
  write(cuControlFD,data.bytes,data.length);
}
static NSTextField *cuLabel(NSString *text, CGFloat size, NSFontWeight weight) {
  NSTextField *label=[NSTextField wrappingLabelWithString:text];
  label.font=[NSFont systemFontOfSize:size weight:weight];
  label.translatesAutoresizingMaskIntoConstraints=NO;
  return label;
}
static NSStackView *cuStack(NSArray *views, NSUserInterfaceLayoutOrientation orientation, CGFloat spacing) {
  NSStackView *stack=[NSStackView stackViewWithViews:views];
  stack.orientation=orientation; stack.spacing=spacing; stack.alignment=orientation==NSUserInterfaceLayoutOrientationVertical?NSLayoutAttributeLeading:NSLayoutAttributeCenterY;
  stack.translatesAutoresizingMaskIntoConstraints=NO; return stack;
}
static NSButton *cuButton(NSString *title, id target, SEL action) {
  NSButton *button=[NSButton buttonWithTitle:title target:target action:action];
  button.bezelStyle=NSBezelStyleRounded; button.controlSize=NSControlSizeRegular; return button;
}
static NSView *cuSeparator(void) {
  NSBox *line=[NSBox new]; line.boxType=NSBoxSeparator; line.translatesAutoresizingMaskIntoConstraints=NO; return line;
}

@interface CUControlPanel : NSObject
@property(retain) NSStatusItem *item;
@property(retain) NSWindow *window;
@property(retain) NSTextField *accessStatus;
@property(retain) NSTextField *screenStatus;
@property(retain) NSTextField *activity;
@property(retain) NSTextField *targets;
@property(retain) NSTextField *checkResult;
@property(retain) NSTextField *errorLabel;
@property(retain) NSTextField *updateStatus;
@property(retain) NSButton *accessButton;
@property(retain) NSButton *screenButton;
@property(retain) NSButton *checkButton;
@property(retain) NSButton *pauseButton;
@property(retain) NSButton *stopButton;
@property(retain) NSButton *updateButton;
@property(retain) NSMenuItem *pauseItem;
@property(retain) NSMenuItem *stopItem;
@property(retain) NSDictionary *state;
- (void)start;
- (void)show:(id)sender;
- (void)tick:(NSTimer *)timer;
@end
@implementation CUControlPanel
- (NSView *)permissionRow:(NSString *)name detail:(NSString *)detail status:(NSTextField **)status button:(NSButton **)button action:(SEL)action {
  *status=cuLabel(@"Checking…",12,NSFontWeightRegular); (*status).textColor=NSColor.secondaryLabelColor;
  NSStackView *text=cuStack(@[cuLabel(name,13,NSFontWeightSemibold),*status],NSUserInterfaceLayoutOrientationVertical,3);
  *button=cuButton(@"Open Settings",self,action); (*button).accessibilityLabel=[@"Set up " stringByAppendingString:name];
  NSStackView *row=cuStack(@[text,*button],NSUserInterfaceLayoutOrientationHorizontal,16);
  [text setContentHuggingPriority:100 forOrientation:NSLayoutConstraintOrientationHorizontal];
  [(*button).widthAnchor constraintEqualToConstant:112].active=YES;
  [text.widthAnchor constraintEqualToConstant:304].active=YES;
  [row.widthAnchor constraintEqualToConstant:432].active=YES;
  row.toolTip=detail; return row;
}
- (void)start {
  self.item=[NSStatusBar.systemStatusBar statusItemWithLength:NSSquareStatusItemLength];
  NSImage *mark=[[[NSImage alloc] initWithContentsOfFile:[NSBundle.mainBundle pathForResource:@"MenuBarIcon" ofType:@"png"]] autorelease];
  if(!mark) mark=[NSImage imageWithSystemSymbolName:@"cursorarrow" accessibilityDescription:@"Computer Use"];
  mark.size=NSMakeSize(18,18); mark.template=YES; self.item.button.image=mark;
  self.item.button.accessibilityLabel=@"Codewhale Computer Use";
  NSMenu *menu=[NSMenu new];
  menu.autoenablesItems=NO;
  NSMenuItem *show=[menu addItemWithTitle:@"Computer Use…" action:@selector(show:) keyEquivalent:@""]; show.target=self;
  [menu addItem:NSMenuItem.separatorItem];
  self.pauseItem=[menu addItemWithTitle:@"Pause" action:@selector(pause:) keyEquivalent:@""]; self.pauseItem.target=self;
  self.stopItem=[menu addItemWithTitle:@"Stop all computer sessions" action:@selector(stop:) keyEquivalent:@""]; self.stopItem.target=self;
  [menu addItem:NSMenuItem.separatorItem];
  NSMenuItem *quit=[menu addItemWithTitle:@"Quit Computer Use" action:@selector(terminate:) keyEquivalent:@""]; quit.target=NSApp;
  self.item.menu=menu; cuControlBuffer=[NSMutableData new];
  [self buildWindow];
  [NSTimer scheduledTimerWithTimeInterval:0.25 target:self selector:@selector(tick:) userInfo:nil repeats:YES];
  cuSend(@"status");
}
- (void)buildWindow {
  self.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,480,650) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable backing:NSBackingStoreBuffered defer:NO];
  self.window.title=@"Computer Use"; self.window.releasedWhenClosed=NO;
  self.window.collectionBehavior=NSWindowCollectionBehaviorMoveToActiveSpace;
  NSImageView *icon=[NSImageView imageViewWithImage:[NSImage imageNamed:NSImageNameApplicationIcon]];
  [icon.widthAnchor constraintEqualToConstant:48].active=YES; [icon.heightAnchor constraintEqualToConstant:48].active=YES;
  NSTextField *byline=cuLabel(@"By Codewhale",12,NSFontWeightRegular); byline.textColor=NSColor.secondaryLabelColor;
  NSStackView *head=cuStack(@[icon,cuStack(@[cuLabel(@"Computer Use",22,NSFontWeightSemibold),byline],NSUserInterfaceLayoutOrientationVertical,3)],NSUserInterfaceLayoutOrientationHorizontal,14);
  NSTextField *intro=cuLabel(@"Let Codewhale see and operate your apps.",13,NSFontWeightRegular);
  NSTextField *access; NSButton *accessButton;
  NSView *ax=[self permissionRow:@"Accessibility" detail:@"Read controls and send input to the app you choose." status:&access button:&accessButton action:@selector(openAccessibility:)]; self.accessStatus=access; self.accessButton=accessButton;
  NSTextField *screen; NSButton *screenButton;
  NSView *sc=[self permissionRow:@"Screen Recording" detail:@"Capture the selected app when the task needs an image." status:&screen button:&screenButton action:@selector(openScreen:)]; self.screenStatus=screen; self.screenButton=screenButton;
  self.checkButton=cuButton(@"Run background check",self,@selector(check:));
  self.checkResult=cuLabel(@"Uses a disposable practice window. Keep your pointer still for a few seconds to measure background isolation.",12,NSFontWeightRegular);
  self.checkResult.textColor=NSColor.secondaryLabelColor;
  NSStackView *setup=cuStack(@[cuLabel(@"Set up this Mac",15,NSFontWeightSemibold),ax,sc,self.checkButton,self.checkResult],NSUserInterfaceLayoutOrientationVertical,14);
  self.activity=cuLabel(@"Connecting to helper…",15,NSFontWeightSemibold);
  self.targets=cuLabel(@"Choose an app in a Codewhale task to begin.",13,NSFontWeightRegular); self.targets.textColor=NSColor.secondaryLabelColor;
  self.pauseButton=cuButton(@"Pause",self,@selector(pause:)); self.stopButton=cuButton(@"Stop all sessions",self,@selector(stop:));
  self.stopButton.hasDestructiveAction=YES;
  NSStackView *buttons=cuStack(@[self.pauseButton,self.stopButton],NSUserInterfaceLayoutOrientationHorizontal,8);
  NSTextField *explain=cuLabel(@"Background actions keep your current app in front. Foreground actions share your desktop. Stop ends every connected computer session.",12,NSFontWeightRegular); explain.textColor=NSColor.secondaryLabelColor;
  self.errorLabel=cuLabel(@"",12,NSFontWeightRegular); self.errorLabel.textColor=NSColor.systemRedColor;
  NSStackView *activity=cuStack(@[self.activity,self.targets,buttons,explain,self.errorLabel],NSUserInterfaceLayoutOrientationVertical,10);
  NSString *version=[NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"]?:@"";
  NSTextField *versionLabel=cuLabel([@"Version " stringByAppendingString:version],11,NSFontWeightRegular); versionLabel.textColor=NSColor.secondaryLabelColor;
  NSButton *help=cuButton(@"Help",self,@selector(help:)); self.updateButton=cuButton(@"Check for updates…",self,@selector(updates:));
  NSStackView *footer=cuStack(@[versionLabel,help,self.updateButton],NSUserInterfaceLayoutOrientationHorizontal,12);
  self.updateStatus=cuLabel(@"",12,NSFontWeightRegular); self.updateStatus.textColor=NSColor.secondaryLabelColor;
  NSStackView *updates=cuStack(@[footer,self.updateStatus],NSUserInterfaceLayoutOrientationVertical,8);
  NSStackView *body=cuStack(@[head,intro,cuSeparator(),setup,cuSeparator(),activity,cuSeparator(),updates],NSUserInterfaceLayoutOrientationVertical,20);
  [self.window.contentView addSubview:body];
  [NSLayoutConstraint activateConstraints:@[[body.topAnchor constraintEqualToAnchor:self.window.contentView.topAnchor constant:24],[body.leadingAnchor constraintEqualToAnchor:self.window.contentView.leadingAnchor constant:24],[body.trailingAnchor constraintEqualToAnchor:self.window.contentView.trailingAnchor constant:-24],[body.bottomAnchor constraintLessThanOrEqualToAnchor:self.window.contentView.bottomAnchor constant:-24]]];
  for(NSView *view in body.arrangedSubviews) [view.widthAnchor constraintEqualToAnchor:body.widthAnchor].active=YES;
  for(NSView *view in @[self.targets,self.checkResult,explain,self.errorLabel,self.updateStatus]) [view.widthAnchor constraintEqualToConstant:432].active=YES;
  [self.window center];
}
- (void)show:(id)sender { [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES]; cuSend(@"status"); }
- (void)openAccessibility:(id)sender {
  NSDictionary *options=@{(__bridge NSString *)kAXTrustedCheckOptionPrompt:@YES}; AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
  [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]];
}
- (void)openScreen:(id)sender {
  CGRequestScreenCaptureAccess();
  [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"]];
}
- (void)pause:(id)sender { cuSend([self.state[@"mode"] isEqual:@"ready"]?@"pause":@"resume"); }
- (void)stop:(id)sender { cuSend(@"stop"); }
- (void)check:(id)sender { self.checkResult.stringValue=@"Checking the practice window…"; cuSend(@"check"); }
- (void)help:(id)sender { [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"https://github.com/Hmbown/codewhale-cu-plugin/blob/main/docs/TROUBLESHOOTING.md"]]; }
- (void)updates:(id)sender {
  if([self.state[@"update"] isKindOfClass:NSDictionary.class] && [self.state[@"update"][@"available"] boolValue]) cuSend(@"install_update");
  else cuSend(@"updates");
}
- (void)render:(NSDictionary *)state {
  self.state=state;
  NSString *mode=state[@"mode"]?:@"stopped"; BOOL ready=[mode isEqual:@"ready"], pending=[state[@"cleanupPending"] boolValue];
  NSArray *sessions=state[@"sessions"]?:@[];
  BOOL foreground=NO, running=NO; NSMutableArray *lines=[NSMutableArray new];
  for(NSDictionary *session in sessions) {
    BOOL shared=[session[@"mode"] isEqual:@"foreground"]; foreground|=shared; running|=[session[@"action"] isKindOfClass:NSString.class];
    if(lines.count<4) [lines addObject:[NSString stringWithFormat:@"%@ · %@",session[@"target"][@"name"]?:@"Application",shared?@"Foreground":@"Background"]];
  }
  if(sessions.count>4) [lines addObject:[NSString stringWithFormat:@"And %lu more sessions",(unsigned long)sessions.count-4]];
  self.activity.stringValue=pending?@"Releasing input…":!ready?([mode isEqual:@"paused"]?@"Paused by you":@"Computer control is stopped"):running?@"Working":@"Ready when you are";
  self.targets.stringValue=lines.count?[lines componentsJoinedByString:@"\n"]:@"Choose an app in a Codewhale task to begin.";
  self.targets.textColor=foreground?NSColor.systemOrangeColor:NSColor.secondaryLabelColor;
  NSString *pauseTitle=ready?@"Pause":[mode isEqual:@"paused"]?@"Resume":@"Allow new sessions";
  self.pauseButton.title=pauseTitle; self.pauseItem.title=pauseTitle;
  self.pauseButton.enabled=!pending; self.pauseItem.enabled=!pending;
  self.stopButton.enabled=![mode isEqual:@"stopped"] && !pending; self.stopItem.enabled=self.stopButton.enabled;
  self.item.button.toolTip=[NSString stringWithFormat:@"Computer Use — %@",self.activity.stringValue];
  BOOL checking=[state[@"checking"] boolValue];
  self.checkButton.title=checking?@"Checking…":@"Run background check";
  self.checkButton.enabled=AXIsProcessTrusted() && CGPreflightScreenCaptureAccess() && ready && !checking && !running;
  if([state[@"backgroundCheck"] isKindOfClass:NSDictionary.class]) self.checkResult.stringValue=state[@"backgroundCheck"][@"message"]?:@"Check finished.";
  self.errorLabel.stringValue=[state[@"error"] isKindOfClass:NSString.class]?state[@"error"]:@"";
  self.errorLabel.hidden=self.errorLabel.stringValue.length==0;
  if(pending && self.errorLabel.stringValue.length) {
    self.activity.stringValue=@"Computer input is blocked";
    self.errorLabel.stringValue=[self.errorLabel.stringValue stringByAppendingString:@" Quit and reopen Computer Use after checking permissions."];
  }
  self.updateStatus.stringValue=@"";
  if([state[@"update"] isKindOfClass:NSDictionary.class]) {
    self.updateStatus.stringValue=state[@"update"][@"message"]?:@"";
    self.updateButton.enabled=![state[@"update"][@"busy"] boolValue];
    self.updateButton.title=[state[@"update"][@"available"] boolValue]?[NSString stringWithFormat:@"Install %@…",state[@"update"][@"version"]]:@"Check for updates…";
  }
  self.updateStatus.hidden=self.updateStatus.stringValue.length==0;
  [self.window.contentView layoutSubtreeIfNeeded];
  // Intrinsic rows grow for several targets, errors and larger system fonts.
  CGFloat height=MAX(640,self.window.contentView.subviews.firstObject.fittingSize.height+48);
  if(fabs(height-self.window.contentView.bounds.size.height)>1) [self.window setContentSize:NSMakeSize(480,height)];
}
- (void)tick:(NSTimer *)timer {
  BOOL ax=AXIsProcessTrusted(), sc=CGPreflightScreenCaptureAccess();
  self.accessStatus.stringValue=ax?@"Granted · read controls and send input":@"Required to read controls and send input";
  self.screenStatus.stringValue=sc?@"Granted · capture app windows":@"Required for app screenshots";
  self.accessButton.title=ax?@"Settings…":@"Allow…"; self.screenButton.title=sc?@"Settings…":@"Allow…";
  if(cuControlFD<0) return;
  char bytes[4096]; ssize_t count;
  while((count=read(cuControlFD,bytes,sizeof bytes))>0) [cuControlBuffer appendBytes:bytes length:(NSUInteger)count];
  if(count==0) { close(cuControlFD); cuControlFD=-1; self.activity.stringValue=@"Helper disconnected"; self.targets.stringValue=@"Quit and reopen Computer Use to reconnect."; self.pauseButton.enabled=NO; self.stopButton.enabled=NO; self.checkButton.enabled=NO; return; }
  if(cuControlBuffer.length>65536) { [cuControlBuffer setLength:0]; return; }
  while(YES) {
    const char *start=cuControlBuffer.bytes; const char *end=memchr(start,'\n',cuControlBuffer.length); if(!end) break;
    NSUInteger length=(NSUInteger)(end-start); NSData *line=[NSData dataWithBytes:start length:length];
    [cuControlBuffer replaceBytesInRange:NSMakeRange(0,length+1) withBytes:NULL length:0];
    NSDictionary *state=[NSJSONSerialization JSONObjectWithData:line options:0 error:nil]; if([state isKindOfClass:NSDictionary.class]) [self render:state];
  }
  cuSend(@"status");
}
@end
