//! Win32 windows owned by the player: the video container (mpv's `wid`) and the
//! picture-in-picture window. Same model as `player_bridge.cpp`: mpv renders into a container
//! child window; PiP moves that container into a separate always-on-top window with `SetParent`,
//! so playback never restarts.
//!
//! All functions here must run on the thread that owns the host window (the UI thread).

use std::sync::{Mutex, OnceLock};
use windows::core::{w, BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH, HBRUSH};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::*;

const CONTAINER_CLASS: PCWSTR = w!("NuvioNextGenVideoContainer");
const PIP_CLASS: PCWSTR = w!("NuvioNextGenPictureInPicture");

/// Default PiP placement, from `DesktopPlayerPictureInPicture.computeDefaultBounds`.
pub const PIP_DEFAULT_WIDTH: i32 = 480;
pub const PIP_MIN_WIDTH: i32 = 320;
pub const PIP_MIN_HEIGHT: i32 = 180;
pub const PIP_SCREEN_MARGIN: i32 = 24;

static CLASSES: OnceLock<()> = OnceLock::new();

/// Aspect ratio enforced while the user resizes the PiP window, and the callback run when the
/// user closes it (the app then restores the video into the main window).
struct PipState {
    aspect: f64,
    on_close: Option<Box<dyn Fn() + Send>>,
}
static PIP_STATE: Mutex<PipState> = Mutex::new(PipState { aspect: 16.0 / 9.0, on_close: None });

fn register_classes() {
    CLASSES.get_or_init(|| unsafe {
        let instance = GetModuleHandleW(None).unwrap_or_default();
        let background = HBRUSH(GetStockObject(BLACK_BRUSH).0);
        let container = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(container_proc),
            hInstance: instance.into(),
            hbrBackground: background,
            lpszClassName: CONTAINER_CLASS,
            hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
            ..Default::default()
        };
        RegisterClassExW(&container);
        let pip = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_DBLCLKS,
            lpfnWndProc: Some(pip_proc),
            hInstance: instance.into(),
            hbrBackground: background,
            lpszClassName: PIP_CLASS,
            hCursor: LoadCursorW(None, IDC_SIZEALL).unwrap_or_default(),
            ..Default::default()
        };
        RegisterClassExW(&pip);
    });
}

unsafe extern "system" fn container_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        // Let clicks fall through to the webview above in the main window.
        WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

fn resize_children_to_client(hwnd: HWND) {
    unsafe {
        let mut rect = RECT::default();
        if GetClientRect(hwnd, &mut rect).is_ok() {
            if let Ok(child) = GetWindow(hwnd, GW_CHILD) {
                let _ = SetWindowPos(child, None, 0, 0, rect.right, rect.bottom, SWP_NOZORDER | SWP_NOACTIVATE);
            }
        }
    }
}

unsafe extern "system" fn pip_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            // Drag anywhere inside the video; borders keep resizing.
            WM_NCHITTEST => {
                let hit = DefWindowProcW(hwnd, msg, wparam, lparam);
                if hit.0 == HTCLIENT as isize { LRESULT(HTCAPTION as isize) } else { hit }
            }
            WM_GETMINMAXINFO => {
                let info = &mut *(lparam.0 as *mut MINMAXINFO);
                info.ptMinTrackSize.x = PIP_MIN_WIDTH;
                info.ptMinTrackSize.y = PIP_MIN_HEIGHT;
                LRESULT(0)
            }
            // Keep the video's aspect ratio while resizing (setWindowAspectRatio in the bridge).
            WM_SIZING => {
                let aspect = PIP_STATE.lock().map(|s| s.aspect).unwrap_or(16.0 / 9.0);
                let rect = &mut *(lparam.0 as *mut RECT);
                let width = (rect.right - rect.left) as f64;
                let height = (rect.bottom - rect.top) as f64;
                match wparam.0 as u32 {
                    WMSZ_TOP | WMSZ_BOTTOM => rect.right = rect.left + (height * aspect).round() as i32,
                    WMSZ_TOPLEFT | WMSZ_TOPRIGHT => rect.top = rect.bottom - (width / aspect).round() as i32,
                    _ => rect.bottom = rect.top + (width / aspect).round() as i32,
                }
                LRESULT(1)
            }
            WM_SIZE => {
                resize_children_to_client(hwnd);
                LRESULT(0)
            }
            WM_CLOSE | WM_NCLBUTTONDBLCLK => {
                let callback = PIP_STATE.lock().ok().and_then(|mut s| s.on_close.take());
                if let Some(callback) = callback {
                    callback();
                }
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}

/// Creates the video container as a child of `host`, at the bottom of the z-order (below the webview).
pub fn create_container(host: HWND) -> Result<HWND, String> {
    register_classes();
    unsafe {
        let mut rect = RECT::default();
        GetClientRect(host, &mut rect).map_err(|e| e.to_string())?;
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            CONTAINER_CLASS,
            w!(""),
            // No WS_CLIPSIBLINGS: the webview host (`WRY_WEBVIEW`) is a sibling above this window and
            // covers the whole client area. With WS_CLIPSIBLINGS the container's visible region (and
            // therefore mpv's video window inside it) would be empty and DWM would never show the video
            // swapchain (white/black areas instead of the picture). Verified with captures.
            WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN,
            0,
            0,
            rect.right.max(1),
            rect.bottom.max(1),
            Some(host),
            None,
            GetModuleHandleW(None).ok().map(Into::into),
            None,
        )
        .map_err(|e| format!("CreateWindowEx(container): {e}"))?;
        let _ = SetWindowPos(hwnd, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        Ok(hwnd)
    }
}

/// Resizes the container to fill its current parent's client area.
pub fn fit_to_parent(container: HWND) {
    unsafe {
        if let Ok(parent) = GetParent(container) {
            let mut rect = RECT::default();
            if GetClientRect(parent, &mut rect).is_ok() {
                let _ = SetWindowPos(container, None, 0, 0, rect.right, rect.bottom, SWP_NOZORDER | SWP_NOACTIVATE);
            }
        }
    }
}

pub fn client_size(hwnd: HWND) -> (i32, i32) {
    let mut rect = RECT::default();
    unsafe {
        let _ = GetClientRect(hwnd, &mut rect);
    }
    (rect.right.max(1), rect.bottom.max(1))
}

pub fn destroy(hwnd: HWND) {
    unsafe {
        let _ = DestroyWindow(hwnd);
    }
}

/// Default PiP bounds for an aspect ratio (`desktopPipBoundsForAspectRatio` + bottom-right placement).
pub fn pip_default_bounds(work_area: RECT, aspect: f64) -> (i32, i32, i32, i32) {
    let width = PIP_DEFAULT_WIDTH.max(PIP_MIN_WIDTH).max((180.0 * aspect).ceil() as i32);
    let height = ((width as f64 / aspect).round() as i32).max(PIP_MIN_HEIGHT);
    (
        work_area.right - width - PIP_SCREEN_MARGIN,
        work_area.bottom - height - PIP_SCREEN_MARGIN,
        width,
        height,
    )
}

/// Opens the PiP window and moves `container` into it.
pub fn enter_pip(container: HWND, title: &str, aspect: f64, on_close: Box<dyn Fn() + Send>) -> Result<HWND, String> {
    register_classes();
    let aspect = if aspect.is_finite() && aspect > 0.0 { aspect } else { 16.0 / 9.0 };
    if let Ok(mut state) = PIP_STATE.lock() {
        state.aspect = aspect;
        state.on_close = Some(on_close);
    }
    unsafe {
        let mut work = RECT::default();
        let _ = SystemParametersInfoW(SPI_GETWORKAREA, 0, Some((&mut work as *mut RECT).cast()), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0));
        let (x, y, w, h) = pip_default_bounds(work, aspect);
        let title: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
        let pip = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            PIP_CLASS,
            PCWSTR(title.as_ptr()),
            WS_POPUP | WS_THICKFRAME | WS_VISIBLE | WS_CLIPCHILDREN,
            x,
            y,
            w,
            h,
            None,
            None,
            GetModuleHandleW(None).ok().map(Into::into),
            None,
        )
        .map_err(|e| format!("CreateWindowEx(pip): {e}"))?;
        SetParent(container, Some(pip)).map_err(|e| format!("SetParent(pip): {e}"))?;
        fit_to_parent(container);
        Ok(pip)
    }
}

/// Moves `container` back into `host` and destroys the PiP window.
pub fn exit_pip(container: HWND, host: HWND, pip: HWND) {
    unsafe {
        let _ = SetParent(container, Some(host));
        let _ = SetWindowPos(container, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        fit_to_parent(container);
        let _ = DestroyWindow(pip);
    }
    if let Ok(mut state) = PIP_STATE.lock() {
        state.on_close = None;
    }
}

/// Number of windows of mpv's class anywhere under `root` (test helper).
pub fn count_mpv_windows(root: HWND) -> usize {
    unsafe extern "system" fn visit(child: HWND, count: LPARAM) -> BOOL {
        let mut class = [0u16; 32];
        let len = unsafe { GetClassNameW(child, &mut class) } as usize;
        if String::from_utf16_lossy(&class[..len]) == "mpv" {
            unsafe { *(count.0 as *mut usize) += 1 };
        }
        BOOL(1)
    }
    let mut count = 0usize;
    unsafe {
        let _ = EnumChildWindows(Some(root), Some(visit), LPARAM(&mut count as *mut usize as isize));
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pip_default_bounds_match_the_original_sizing() {
        let work = RECT { left: 0, top: 0, right: 1920, bottom: 1040 };
        // 16:9 → 480×270, bottom-right with a 24 px margin.
        assert_eq!(pip_default_bounds(work, 16.0 / 9.0), (1920 - 480 - 24, 1040 - 270 - 24, 480, 270));
        // Very wide video: width grows so the height reaches 180 (ceil(180 × ratio)).
        assert_eq!(pip_default_bounds(work, 4.0).2, 720);
        assert_eq!(pip_default_bounds(work, 4.0).3, 180);
    }
}
