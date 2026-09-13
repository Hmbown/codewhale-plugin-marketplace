// Codewhale Computer Use — macOS bundle executable.
//
// macOS grants Accessibility / Screen Recording to the *responsible process*
// of a permission check. A shell-script launcher that exec()s node makes node
// the responsible process, so the grant lands on "node", not on the app. This
// tiny Mach-O stays alive as the app's process and runs node as its child:
// children inherit responsibility, so every osascript / screencapture the
// daemon spawns is attributed to "Codewhale Computer Use" and the app shows
// up by name and icon under System Settings → Privacy & Security.
//
// Built by scripts/build-app.mjs (clang, universal, ad-hoc signed) into
// assets/macos/codewhale-cu, which is committed so non-mac builds still work.
#import <Cocoa/Cocoa.h>
#include <ApplicationServices/ApplicationServices.h>
#include <CoreGraphics/CoreGraphics.h>
#include <errno.h>
#include <glob.h>
#include <fcntl.h>
#include <libgen.h>
#include <mach-o/dyld.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include <sys/socket.h>
#include "control-panel.h"

extern char **environ;

static pid_t child = 0;

static void forward(int sig) {
  if (child > 0) kill(child, sig);
}

static int executable(const char *p) {
  struct stat st;
  return p && *p && stat(p, &st) == 0 && S_ISREG(st.st_mode) && access(p, X_OK) == 0;
}

static void trim(char *s) {
  size_t n = strlen(s);
  while (n && (s[n - 1] == '\n' || s[n - 1] == '\r' || s[n - 1] == ' ')) s[--n] = 0;
}

/* Newest node under a versions dir (nvm / fnm layouts). */
static int newest_glob(const char *pattern, char *out, size_t cap) {
  glob_t g;
  int found = 0;
  if (glob(pattern, 0, NULL, &g) == 0) {
    for (size_t i = 0; i < g.gl_pathc; i++) {
      if (executable(g.gl_pathv[i])) { strlcpy(out, g.gl_pathv[i], cap); found = 1; } /* glob sorts; last wins */
    }
  }
  globfree(&g);
  return found;
}

static int find_node(const char *contents, const char *home, char *out, size_t cap) {
  snprintf(out, cap, "%s/MacOS/node", contents);
  if (executable(out)) return 1;
  char pinned[PATH_MAX];
  snprintf(pinned, sizeof pinned, "%s/Resources/node-path", contents);
  FILE *f = fopen(pinned, "r");
  if (f) {
    if (fgets(out, (int)cap, f)) { trim(out); if (executable(out)) { fclose(f); return 1; } }
    fclose(f);
  }
  const char *fixed[] = { "/opt/homebrew/bin/node", "/usr/local/bin/node", "/opt/local/bin/node", NULL };
  for (int i = 0; fixed[i]; i++) if (executable(fixed[i])) { strlcpy(out, fixed[i], cap); return 1; }
  const char *rel[] = { "/.volta/bin/node", "/.local/share/fnm/aliases/default/bin/node", "/.fnm/aliases/default/bin/node", NULL };
  for (int i = 0; rel[i]; i++) {
    snprintf(out, cap, "%s%s", home, rel[i]);
    if (executable(out)) return 1;
  }
  char pat[PATH_MAX];
  snprintf(pat, sizeof pat, "%s/.nvm/versions/node/*/bin/node", home);
  if (newest_glob(pat, out, cap)) return 1;
  snprintf(pat, sizeof pat, "%s/.local/share/fnm/node-versions/*/installation/bin/node", home);
  if (newest_glob(pat, out, cap)) return 1;
  /* PATH as launched (LaunchServices gives a minimal one, but try). */
  const char *path = getenv("PATH");
  if (path) {
    char *dup = strdup(path), *save = NULL;
    for (char *dir = strtok_r(dup, ":", &save); dir; dir = strtok_r(NULL, ":", &save)) {
      snprintf(out, cap, "%s/node", dir);
      if (executable(out)) { free(dup); return 1; }
    }
    free(dup);
  }
  out[0] = 0;
  return 0;
}

static void alert(const char *message) {
  char script[512];
  snprintf(script, sizeof script, "display alert \"Codewhale Computer Use\" message \"%s\"", message);
  char *argv[] = { "/usr/bin/osascript", "-e", script, NULL };
  pid_t p;
  if (posix_spawn(&p, argv[0], NULL, NULL, argv, environ) == 0) waitpid(p, NULL, 0);
}

// The agent pointer is drawn in an app preview, never by moving the user's
// hardware pointer. The nonactivating panel accepts no keyboard focus.
@interface CUPreviewView : NSView
@property(retain) NSImage *image;
@property CGFloat pointerX;
@property CGFloat pointerY;
@end
@implementation CUPreviewView
- (BOOL)isFlipped { return YES; }
- (void)drawRect:(NSRect)dirty {
  [[NSColor colorWithCalibratedWhite:0.08 alpha:1] setFill]; NSRectFill(self.bounds);
  if (!self.image) return;
  NSSize size=self.image.size;
  CGFloat scale=MIN(self.bounds.size.width/size.width,self.bounds.size.height/size.height);
  NSRect frame=NSMakeRect((self.bounds.size.width-size.width*scale)/2,(self.bounds.size.height-size.height*scale)/2,size.width*scale,size.height*scale);
  [self.image drawInRect:frame fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES hints:nil];
  if(self.pointerX<0 || self.pointerX>1 || self.pointerY<0 || self.pointerY>1) return;
  CGFloat x=frame.origin.x+self.pointerX*frame.size.width, y=frame.origin.y+self.pointerY*frame.size.height;
  NSBezierPath *cursor=[NSBezierPath bezierPath];
  [cursor moveToPoint:NSMakePoint(x,y)]; [cursor lineToPoint:NSMakePoint(x+3,y+24)]; [cursor lineToPoint:NSMakePoint(x+10,y+17)]; [cursor lineToPoint:NSMakePoint(x+20,y+16)]; [cursor closePath];
  [[NSColor colorWithCalibratedRed:0.2 green:0.88 blue:0.94 alpha:1] setFill]; [cursor fill]; [[NSColor blackColor] setStroke]; cursor.lineWidth=1.5; [cursor stroke];
  [@"Codewhale" drawAtPoint:NSMakePoint(x+23,y+12) withAttributes:@{NSFontAttributeName:[NSFont boldSystemFontOfSize:12],NSForegroundColorAttributeName:[NSColor colorWithCalibratedRed:0.2 green:0.88 blue:0.94 alpha:1],NSBackgroundColorAttributeName:[NSColor colorWithCalibratedWhite:0.08 alpha:0.9]}];
}
@end
@interface CUPreviewPanel : NSPanel
@end
@implementation CUPreviewPanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

@interface CUAppDelegate : NSObject <NSApplicationDelegate>
- (void)pollChild:(NSTimer *)timer;
- (void)updatePreview:(NSNotification *)notification;
@property(retain) CUPreviewPanel *previewPanel;
@property(retain) CUPreviewView *previewView;
@property(retain) CUControlPanel *controls;
@end
@implementation CUAppDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  self.controls=[CUControlPanel new]; [self.controls start];
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
  [self.controls show:nil]; return YES;
}
- (void)updatePreview:(NSNotification *)notification {
  NSDictionary *data=notification.userInfo;
  if (![data[@"enabled"] boolValue]) { [self.previewPanel orderOut:nil]; return; }
  if (!self.previewPanel) {
    NSRect screen=NSScreen.mainScreen.visibleFrame;
    self.previewPanel=[[CUPreviewPanel alloc] initWithContentRect:NSMakeRect(NSMaxX(screen)-580,NSMinY(screen)+40,560,360) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskResizable|NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    self.previewPanel.releasedWhenClosed=NO; self.previewPanel.hidesOnDeactivate=NO;
    self.previewView=[[CUPreviewView alloc] initWithFrame:NSMakeRect(0,0,560,360)];
    self.previewView.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
    self.previewPanel.contentView=self.previewView;
  }
  NSString *file=[NSHomeDirectory() stringByAppendingPathComponent:@".codewhale-cu/preview/latest.png"];
  self.previewView.image=[[[NSImage alloc] initWithContentsOfFile:file] autorelease];
  self.previewView.pointerX=[data[@"x"] doubleValue]; self.previewView.pointerY=[data[@"y"] doubleValue];
  self.previewPanel.title=[data[@"title"] isKindOfClass:NSString.class]?data[@"title"]:@"Codewhale activity";
  [self.previewView setNeedsDisplay:YES];
  if([data[@"show"] boolValue]) [self.previewPanel orderFrontRegardless];
}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
  forward(SIGTERM);
  return NSTerminateNow;
}
- (void)pollChild:(NSTimer *)timer {
  int status = 0;
  if (waitpid(child, &status, WNOHANG) == child)
    exit(WIFEXITED(status) ? WEXITSTATUS(status) : 1);
}
@end

int main(void) {
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  CUAppDelegate *delegate = [CUAppDelegate new];
  [NSApp setDelegate:delegate];
  [[NSDistributedNotificationCenter defaultCenter] addObserver:delegate selector:@selector(updatePreview:) name:@"net.codewhale.computer-use.preview" object:nil];
  char exe[PATH_MAX];
  uint32_t size = sizeof exe;
  if (_NSGetExecutablePath(exe, &size) != 0) return 1;
  char real[PATH_MAX];
  if (!realpath(exe, real)) return 1;
  char macos_dir[PATH_MAX], contents[PATH_MAX], bundle[PATH_MAX];
  strlcpy(macos_dir, dirname(real), sizeof macos_dir);
  strlcpy(contents, dirname(macos_dir), sizeof contents);
  strlcpy(bundle, dirname(contents), sizeof bundle);

  const char *home = getenv("HOME");
  if (!home || !*home) home = "/tmp";

  char logdir[PATH_MAX], logfile[PATH_MAX];
  snprintf(logdir, sizeof logdir, "%s/Library/Logs/Codewhale Computer Use", home);
  mkdir(logdir, 0755);
  snprintf(logfile, sizeof logfile, "%s/app.log", logdir);
  int log = open(logfile, O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (log >= 0) { dup2(log, STDOUT_FILENO); dup2(log, STDERR_FILENO); close(log); }

  // Permission prompts are attached to the person's setup buttons. An MCP
  // background launch must not interrupt them with System Settings dialogs.

  char node[PATH_MAX];
  if (!find_node(contents, home, node, sizeof node)) {
    fprintf(stderr, "Codewhale Computer Use: Node.js 20+ not found\n");
    alert("Node.js 20 or newer was not found. Install it from nodejs.org, then open the app again.");
    return 1;
  }

  char daemon[PATH_MAX];
  snprintf(daemon, sizeof daemon, "%s/Resources/plugin/app/daemon.mjs", contents);
  setenv("CODEWHALE_CU_APP_BUNDLE", bundle, 1);

  char *argv[] = { node, daemon, NULL };
  posix_spawnattr_t attr;
  posix_spawnattr_init(&attr);
  int control[2];
  if(socketpair(AF_UNIX,SOCK_STREAM,0,control)!=0) { alert("Could not create the local safety controls. Reopen the app to retry."); return 1; }
  cuControlFD=control[0];
  fcntl(cuControlFD,F_SETFL,fcntl(cuControlFD,F_GETFL)|O_NONBLOCK);
  fcntl(cuControlFD,F_SETFD,FD_CLOEXEC);
  int noSigpipe=1; setsockopt(cuControlFD,SOL_SOCKET,SO_NOSIGPIPE,&noSigpipe,sizeof noSigpipe);
  posix_spawn_file_actions_t actions; posix_spawn_file_actions_init(&actions);
  // Close the parent's end before dup2; it can itself be descriptor 3.
  posix_spawn_file_actions_addclose(&actions,control[0]);
  posix_spawn_file_actions_adddup2(&actions,control[1],3);
  if(control[1]!=3) posix_spawn_file_actions_addclose(&actions,control[1]);
  setenv("CODEWHALE_CU_CONTROL_FD","3",1);
  int rc = posix_spawn(&child, node, &actions, &attr, argv, environ);
  unsetenv("CODEWHALE_CU_CONTROL_FD");
  posix_spawn_file_actions_destroy(&actions); close(control[1]);
  posix_spawnattr_destroy(&attr);
  if (rc != 0) {
    fprintf(stderr, "Codewhale Computer Use: could not start %s: %s\n", node, strerror(rc));
    return 1;
  }
  signal(SIGTERM, forward);
  signal(SIGINT, forward);
  signal(SIGHUP, forward);

  // Process standard macOS Quit/Reopen events instead of blocking in waitpid.
  [NSTimer scheduledTimerWithTimeInterval:0.25 target:delegate selector:@selector(pollChild:) userInfo:nil repeats:YES];
  [NSApp run];
  forward(SIGTERM);
  return 0;
}
