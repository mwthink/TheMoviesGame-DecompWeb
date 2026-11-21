/* ghidra_shim.h - maps Ghidra decompiler pseudo-types and helper macros onto real C for MSVC (32-bit, C mode).
 *
 * Compile generated sources with:  cl /nologo /TC /c <file>.c      (or /Zs for a syntax-only check)
 *
 * Calling conventions: MSVC does not allow __thiscall on free functions. The shim turns __thiscall into __fastcall,
 * which matches the *register* usage for 'this' (ECX) but not the stack layout for the remaining arguments. That is fine
 * for compile checks; a real replacement of a game function must go through a hand-written ABI wrapper (see the
 * detours in src/hooks) until the generator learns to rewrite call sites.
 */
#pragma once
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#ifdef _WIN32
#include <windows.h>
#endif
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <math.h>
#include <stdbool.h>

/* ---- Ghidra primitive types ------------------------------------------------------------------------------------ */
typedef uint8_t   undefined, undefined1, byte, uchar, bool8;
typedef uint16_t  undefined2, ushort;
typedef uint32_t  undefined3, undefined4, uint, ulong, dword;
typedef uint64_t  undefined5, undefined6, undefined7, undefined8, ulonglong;
typedef int64_t   longlong;
typedef uint32_t  uint3, uint5, uint6, uint7;
typedef int32_t   int3;
typedef int64_t   int5, int6, int7;
typedef double    float10, unkbyte10;          /* x87 extended values are carried as double in checks (precision differs) */
typedef uint32_t  code();           /* unprototyped function returning the 32-bit value left in EAX; calls through (code *) take any arguments in C */
typedef int       bool_;
typedef unsigned long u_long;

/* ---- calling conventions ------------------------------------------------------------------------------------------ */
#ifndef _WIN32
/* Non-Windows build (arm64 macOS): no x86 calling conventions, and the Win32 declarations come from the slice that
 * tools/win32_slice.py cuts out of the MinGW headers (with 32-bit Windows type sizes). */
#define __cdecl
#define __stdcall
#define __fastcall
#define __thiscall
#define __declspec(x)
#include "win32_compat.h"
#elif !defined(__clang__)
#define __thiscall __fastcall   /* MSVC only; clang's i686 target has a real __thiscall */
#endif

/* ---- bit-twiddling helper macros emitted by the decompiler ---------------------------------------------------- */
#define CONCAT11(a, b) ((uint16_t)(((uint16_t)(uint8_t)(a) << 8) | (uint8_t)(b)))
#define CONCAT12(a, b) ((uint32_t)(((uint32_t)(uint8_t)(a) << 16) | (uint16_t)(b)))
#define CONCAT13(a, b) ((uint32_t)(((uint32_t)(uint8_t)(a) << 24) | ((uint32_t)(b) & 0xFFFFFF)))
#define CONCAT21(a, b) ((uint32_t)(((uint32_t)(uint16_t)(a) << 8) | (uint8_t)(b)))
#define CONCAT22(a, b) ((uint32_t)(((uint32_t)(uint16_t)(a) << 16) | (uint16_t)(b)))
#define CONCAT31(a, b) ((uint32_t)(((uint32_t)(a) << 8) | (uint8_t)(b)))
#define CONCAT32(a, b) ((uint64_t)(((uint64_t)(uint32_t)(a) << 16) | (uint16_t)(b)))
#define CONCAT41(a, b) ((uint64_t)(((uint64_t)(uint32_t)(a) << 8) | (uint8_t)(b)))
#define CONCAT42(a, b) ((uint64_t)(((uint64_t)(uint32_t)(a) << 16) | (uint16_t)(b)))
#define CONCAT43(a, b) ((uint64_t)(((uint64_t)(uint32_t)(a) << 24) | ((uint32_t)(b) & 0xFFFFFF)))
#define CONCAT44(a, b) ((uint64_t)(((uint64_t)(uint32_t)(a) << 32) | (uint32_t)(b)))
/* remaining CONCATab(hi, lo): hi has a bytes, lo has b bytes (result at most 8 bytes) */
#define CONCAT_BYTES(hi, lo, b) (((uint64_t)(hi) << (8 * (b))) | ((uint64_t)(lo) & ((1ULL << (8 * (b))) - 1)))
#define CONCAT14(a, b) CONCAT_BYTES(a, b, 4)
#define CONCAT15(a, b) CONCAT_BYTES(a, b, 5)
#define CONCAT16(a, b) CONCAT_BYTES(a, b, 6)
#define CONCAT17(a, b) CONCAT_BYTES(a, b, 7)
#define CONCAT24(a, b) CONCAT_BYTES(a, b, 4)
#define CONCAT25(a, b) CONCAT_BYTES(a, b, 5)
#define CONCAT26(a, b) CONCAT_BYTES(a, b, 6)
#define CONCAT34(a, b) CONCAT_BYTES(a, b, 4)
#define CONCAT51(a, b) CONCAT_BYTES(a, b, 1)
#define CONCAT52(a, b) CONCAT_BYTES(a, b, 2)
#define CONCAT62(a, b) CONCAT_BYTES(a, b, 2)
#define SUB41(x, n) ((uint8_t)((uint32_t)(x) >> (8 * (n))))
#define SUB42(x, n) ((uint16_t)((uint32_t)(x) >> (8 * (n))))
#define SUB43(x, n) ((uint32_t)((uint32_t)(x) >> (8 * (n))) & 0xFFFFFF)
#define SUB81(x, n) ((uint8_t)((uint64_t)(x) >> (8 * (n))))
#define SUB82(x, n) ((uint16_t)((uint64_t)(x) >> (8 * (n))))
#define SUB84(x, n) ((uint32_t)((uint64_t)(x) >> (8 * (n))))
#define SUB21(x, n) ((uint8_t)((uint16_t)(x) >> (8 * (n))))
#define ZEXT14(x) ((uint32_t)(uint8_t)(x))
#define ZEXT24(x) ((uint32_t)(uint16_t)(x))
#define ZEXT48(x) ((uint64_t)(uint32_t)(x))
#define ZEXT28(x) ((uint64_t)(uint16_t)(x))
#define ZEXT18(x) ((uint64_t)(uint8_t)(x))
#define SEXT14(x) ((int32_t)(int8_t)(x))
#define SEXT24(x) ((int32_t)(int16_t)(x))
#define SEXT48(x) ((int64_t)(int32_t)(x))
#define CARRY4(a, b)   ((uint32_t)(a) + (uint32_t)(b) < (uint32_t)(a))
#define SCARRY4(a, b)  ((((int32_t)(a) ^ (int32_t)((uint32_t)(a) + (uint32_t)(b))) & ((int32_t)(b) ^ (int32_t)((uint32_t)(a) + (uint32_t)(b)))) < 0)
#define SBORROW4(a, b) (((((int32_t)(a)) ^ ((int32_t)(b))) & (((int32_t)(a)) ^ (int32_t)((uint32_t)(a) - (uint32_t)(b)))) < 0)
#define CARRY2(a, b)   ((uint16_t)((uint16_t)(a) + (uint16_t)(b)) < (uint16_t)(a))
#define CARRY1(a, b)   ((uint8_t)((uint8_t)(a) + (uint8_t)(b)) < (uint8_t)(a))
#ifdef _WIN32
#define POPCOUNT(x)    __popcnt((uint32_t)(x))
#else
#define POPCOUNT(x)    __builtin_popcount((uint32_t)(x))
#endif
#define ABS(x)         fabs((double)(x))
#undef NAN
#ifdef _WIN32
#define NAN(x)         _isnan((double)(x))
#else
#define NAN(x)         isnan((double)(x))
#endif
#define ROUND(x)       ((int64_t)floor((double)(x) + 0.5))
#define MULTIPLY(a, b) ((a) * (b))
#define swi(n)         ((code *)0)   /* int 3 / int 2d: only used as swi(3)(); never meaningful at runtime */

/* ---- x87 intrinsics ----------------------------------------------------------------------------------------------- */
#define fcos(x)    cos((double)(x))
#define fsin(x)    sin((double)(x))
#define ftan(x)    tan((double)(x))
#define fpatan(y, x) atan2((double)(y), (double)(x))
#define fsqrt(x)   sqrt((double)(x))
#define f2xm1(x)   (pow(2.0, (double)(x)) - 1.0)
#define fscale(x, n) ldexp((double)(x), (int)(n))
#define fyl2x(y, x) ((double)(y) * log2((double)(x)))
#define frndint(x) floor((double)(x) + 0.5)

/* ---- globals the pseudo-C refers to without declaring ------------------------------------------------------------- */
extern uint8_t ghidra_stack_arg[];        /* stand-in for the decompiler's stack0xNNNN temporaries */
extern void* ExceptionList;               /* fs:[0], the SEH chain head; skipped in real code */
extern void* operator_new(size_t);
extern void  halt_baddata(void);
extern void  halt_unimplemented(void);
#ifdef _MSC_VER
#define GHIDRA_STUB() __debugbreak()   /* body of a function that did not compile; see gen/stubbed_functions.txt */
#else
#define GHIDRA_STUB() __builtin_trap()
#endif
