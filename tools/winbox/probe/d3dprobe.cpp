// Direct3D 9 probe: what does this machine offer, and which CreateDevice calls succeed with the parameters MoviesSE.exe uses?
// MoviesSE (FUN_009A7A50) calls CreateDevice(0, HAL, hwnd, HW_VP or SW_VP [| MULTITHREADED], pp) with D16 depth, back buffer
// format = the adapter's display format, and either a window or a fullscreen mode. Build: cl /EHsc d3dprobe.cpp d3d9.lib user32.lib
#include <d3d9.h>
#include <cstdio>
#include <windows.h>

static const char* Hr(HRESULT hr)
{
    switch ((unsigned)hr) {
        case 0: return "OK";
        case 0x8876086C: return "D3DERR_INVALIDCALL";
        case 0x8876086A: return "D3DERR_NOTAVAILABLE";
        case 0x88760B59: return "D3DERR_DEVICELOST";
        case 0x8876017C: return "E_OUTOFMEMORY(D3D)";
        case 0x88760868: return "D3DERR_DRIVERINTERNALERROR";
        default: { static char b[16]; sprintf_s(b, "0x%08X", (unsigned)hr); return b; }
    }
}

static HWND MakeWindow()
{
    WNDCLASSA wc = {}; wc.lpfnWndProc = DefWindowProcA; wc.hInstance = GetModuleHandleA(nullptr); wc.lpszClassName = "probe";
    RegisterClassA(&wc);
    return CreateWindowA("probe", "probe", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, 800, 600, nullptr, nullptr, wc.hInstance, nullptr);
}

int main()
{
    IDirect3D9* d3d = Direct3DCreate9(D3D_SDK_VERSION);
    printf("Direct3DCreate9: %s\n", d3d ? "OK" : "FAILED");
    if (!d3d) return 1;
    printf("adapters: %u\n", d3d->GetAdapterCount());
    D3DADAPTER_IDENTIFIER9 id = {};
    if (SUCCEEDED(d3d->GetAdapterIdentifier(0, 0, &id))) printf("adapter 0: %s | driver %s | vendor %04X device %04X\n", id.Description, id.Driver, id.VendorId, id.DeviceId);
    D3DDISPLAYMODE dm = {};
    HRESULT hr = d3d->GetAdapterDisplayMode(0, &dm);
    printf("GetAdapterDisplayMode: %s  %ux%u format %d refresh %u\n", Hr(hr), dm.Width, dm.Height, (int)dm.Format, dm.RefreshRate);
    printf("adapter modes (X8R8G8B8): %u, (R5G6B5): %u\n", d3d->GetAdapterModeCount(0, D3DFMT_X8R8G8B8), d3d->GetAdapterModeCount(0, D3DFMT_R5G6B5));
    for (UINT i = 0; i < d3d->GetAdapterModeCount(0, D3DFMT_X8R8G8B8) && i < 40; ++i) {
        D3DDISPLAYMODE m; if (SUCCEEDED(d3d->EnumAdapterModes(0, D3DFMT_X8R8G8B8, i, &m))) printf("  mode %u: %ux%u @%u\n", i, m.Width, m.Height, m.RefreshRate);
    }
    for (int type = D3DDEVTYPE_HAL; type <= D3DDEVTYPE_REF; ++type) {
        D3DCAPS9 caps = {};
        hr = d3d->GetDeviceCaps(0, (D3DDEVTYPE)type, &caps);
        printf("GetDeviceCaps(type %d): %s", type, Hr(hr));
        if (SUCCEEDED(hr))
            printf("  VS %u.%u PS %u.%u  HW T&L %s  PureDevice %s  MaxTex %ux%u  MaxVSConst %u  SimultRT %u  DevCaps 0x%08X",
                   D3DSHADER_VERSION_MAJOR(caps.VertexShaderVersion), D3DSHADER_VERSION_MINOR(caps.VertexShaderVersion),
                   D3DSHADER_VERSION_MAJOR(caps.PixelShaderVersion), D3DSHADER_VERSION_MINOR(caps.PixelShaderVersion),
                   (caps.DevCaps & D3DDEVCAPS_HWTRANSFORMANDLIGHT) ? "yes" : "no", (caps.DevCaps & D3DDEVCAPS_PUREDEVICE) ? "yes" : "no",
                   caps.MaxTextureWidth, caps.MaxTextureHeight, caps.MaxVertexShaderConst, caps.NumSimultaneousRTs, (unsigned)caps.DevCaps);
        printf("\n");
    }
    printf("CheckDeviceType windowed X8R8G8B8: %s\n", Hr(d3d->CheckDeviceType(0, D3DDEVTYPE_HAL, dm.Format, dm.Format, TRUE)));
    printf("CheckDeviceFormat D16 depth: %s\n", Hr(d3d->CheckDeviceFormat(0, D3DDEVTYPE_HAL, dm.Format, D3DUSAGE_DEPTHSTENCIL, D3DRTYPE_SURFACE, D3DFMT_D16)));

    HWND hwnd = MakeWindow();
    struct Case { const char* name; BOOL windowed; UINT w, h; D3DFORMAT fmt; DWORD behavior; D3DDEVTYPE type; } cases[] = {
        {"windowed 800x600, HW vp", TRUE, 800, 600, dm.Format, D3DCREATE_HARDWARE_VERTEXPROCESSING, D3DDEVTYPE_HAL},
        {"windowed 800x600, SW vp", TRUE, 800, 600, dm.Format, D3DCREATE_SOFTWARE_VERTEXPROCESSING, D3DDEVTYPE_HAL},
        {"windowed 800x600, mixed vp", TRUE, 800, 600, dm.Format, D3DCREATE_MIXED_VERTEXPROCESSING, D3DDEVTYPE_HAL},
        {"windowed, HW vp|multithreaded", TRUE, 800, 600, dm.Format, D3DCREATE_HARDWARE_VERTEXPROCESSING | D3DCREATE_MULTITHREADED, D3DDEVTYPE_HAL},
        {"fullscreen 800x600 X8R8G8B8, HW vp", FALSE, 800, 600, D3DFMT_X8R8G8B8, D3DCREATE_HARDWARE_VERTEXPROCESSING, D3DDEVTYPE_HAL},
        {"fullscreen 800x600 X8R8G8B8, SW vp", FALSE, 800, 600, D3DFMT_X8R8G8B8, D3DCREATE_SOFTWARE_VERTEXPROCESSING, D3DDEVTYPE_HAL},
        {"fullscreen 1024x768 X8R8G8B8, SW vp", FALSE, 1024, 768, D3DFMT_X8R8G8B8, D3DCREATE_SOFTWARE_VERTEXPROCESSING, D3DDEVTYPE_HAL},
        {"fullscreen 1280x800 X8R8G8B8, SW vp", FALSE, 1280, 800, D3DFMT_X8R8G8B8, D3DCREATE_SOFTWARE_VERTEXPROCESSING, D3DDEVTYPE_HAL},
        {"fullscreen 800x600 R5G6B5, SW vp", FALSE, 800, 600, D3DFMT_R5G6B5, D3DCREATE_SOFTWARE_VERTEXPROCESSING, D3DDEVTYPE_HAL},
        {"REF windowed, SW vp", TRUE, 800, 600, dm.Format, D3DCREATE_SOFTWARE_VERTEXPROCESSING, D3DDEVTYPE_REF},
    };
    for (const Case& c : cases) {
        D3DPRESENT_PARAMETERS pp = {};
        pp.BackBufferWidth = c.w; pp.BackBufferHeight = c.h; pp.BackBufferFormat = c.fmt; pp.BackBufferCount = 1;
        pp.SwapEffect = D3DSWAPEFFECT_DISCARD; pp.hDeviceWindow = hwnd; pp.Windowed = c.windowed;
        pp.EnableAutoDepthStencil = TRUE; pp.AutoDepthStencilFormat = D3DFMT_D16;
        pp.FullScreen_RefreshRateInHz = c.windowed ? 0 : 60; pp.PresentationInterval = D3DPRESENT_INTERVAL_ONE;
        IDirect3DDevice9* dev = nullptr;
        hr = d3d->CreateDevice(0, c.type, hwnd, c.behavior, &pp, &dev);
        printf("CreateDevice %-40s : %s\n", c.name, Hr(hr));
        if (dev) dev->Release();
    }
    d3d->Release();
    return 0;
}
