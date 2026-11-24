// Decompiles the functions at the given addresses and lists their callers. For looking at a few functions of a program without
// exporting all of them (see ExportDecompiled.java for the whole program).
// Read-only: does not modify the Ghidra program.
//
// Headless: analyzeHeadless <projectDir> <projectName> -process <program> -noanalysis -readOnly
//           -scriptPath <this folder> -postScript DecompileAddrs.java <out.txt> <addr> [<addr> ...] [--callers]
//   With --callers, the callers of each address are decompiled too (one level). With --asm, each function's disassembly follows its C
//   (the decompiler loses stack arguments such as floats pushed for a call; the instructions show the real order).
//
//@category Export

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.symbol.Reference;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

public class DecompileAddrs extends GhidraScript {

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length < 2) {
			printerr("usage: DecompileAddrs.java <out.txt> <addr>... [--callers]");
			return;
		}
		boolean callers = false, asm = false;
		Map<Address, String> todo = new LinkedHashMap<>();
		try (BufferedWriter w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(new File(args[0])), StandardCharsets.UTF_8))) {
			DecompInterface di = new DecompInterface();
			di.openProgram(currentProgram);
			for (int i = 1; i < args.length; i++) {
				if (args[i].equals("--callers")) {
					callers = true;
				}
				if (args[i].equals("--asm")) {
					asm = true;
				}
			}
			for (int i = 1; i < args.length; i++) {
				if (args[i].startsWith("--")) {
					continue;
				}
				Address a = toAddr(args[i]);
				Function f = getFunctionAt(a);
				if (f == null) {
					w.write("//// no function at " + args[i] + "\n");
					continue;
				}
				todo.put(a, "requested");
				if (callers) {
					w.write("//// callers of " + f.getName() + " @ " + a + ":");
					for (Reference r : getReferencesTo(a)) {
						Function c = getFunctionContaining(r.getFromAddress());
						if (c != null && !todo.containsKey(c.getEntryPoint())) {
							todo.put(c.getEntryPoint(), "caller of " + a);
							w.write(" " + c.getEntryPoint());
						}
					}
					w.write("\n");
				}
			}
			for (Map.Entry<Address, String> e : todo.entrySet()) {
				Function f = getFunctionAt(e.getKey());
				DecompileResults res = di.decompileFunction(f, 60, monitor);
				w.write("\n//// FUNCTION " + f.getName() + " @ " + f.getEntryPoint() + " (" + e.getValue() + ", " + f.getBody().getNumAddresses() + " bytes) ////\n\n");
				w.write(res.decompileCompleted() ? res.getDecompiledFunction().getC() : "// decompile failed: " + res.getErrorMessage() + "\n");
				if (asm) {
					w.write("\n//// ASM " + f.getName() + " ////\n");
					InstructionIterator it = currentProgram.getListing().getInstructions(f.getBody(), true);
					while (it.hasNext()) {
						Instruction ins = it.next();
						w.write(ins.getAddress() + ": " + ins + "\n");
					}
				}
			}
			di.dispose();
		}
		println("DecompileAddrs: wrote " + todo.size() + " functions to " + args[0]);
	}
}
