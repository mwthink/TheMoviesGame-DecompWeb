// Applies tools/ghidra_names.csv (address,name) to the open Ghidra program: every function whose current name differs
// from the CSV name is renamed. Functions still called FUN_xxxxxxxx in the CSV are left alone. This is how the
// project's names are restored into a freshly imported/analyzed MoviesSE.exe (the Ghidra project itself is local-only).
// Names containing "::" are placed into the matching (nested) namespace.
//
// Headless: analyzeHeadless <projectDir> <projectName> -process MoviesSE.exe -noanalysis
//           -scriptPath <repo>/ghidra/scripts -postScript ApplyNames.java <names.csv> [dry] [create]
// With "create", CSV addresses that have no function get one (disassembled first). With "dry" nothing is changed; the script only reports counts (use it to check that the new analysis lines up).
//
//@category Names

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Namespace;
import ghidra.program.model.symbol.SourceType;
import ghidra.app.util.NamespaceUtils;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.util.ArrayList;
import java.util.List;

public class ApplyNames extends GhidraScript {

	@Override
	protected void run() throws Exception {
		String[] args = getScriptArgs();
		File csv = (args != null && args.length > 0) ? new File(args[0])
				: askFile("names CSV (address,name)", "Apply");
		boolean dry = false, create = false;
		for (int i = 1; args != null && i < args.length; i++) {
			dry |= args[i].equalsIgnoreCase("dry");
			create |= args[i].equalsIgnoreCase("create");
		}

		FunctionManager fm = currentProgram.getFunctionManager();
		println("Program functions: " + fm.getFunctionCount());

		int rows = 0, created = 0, missingNamed = 0, missing = 0, same = 0, renamed = 0, skippedDefault = 0, failed = 0;
		List<String> missingSample = new ArrayList<>();
		List<String> failedSample = new ArrayList<>();

		int tx = dry ? -1 : currentProgram.startTransaction("ApplyNames");
		try (BufferedReader r = new BufferedReader(new FileReader(csv))) {
			String line = r.readLine(); // header
			while ((line = r.readLine()) != null) {
				line = line.trim();
				if (line.isEmpty()) {
					continue;
				}
				int comma = line.indexOf(',');
				if (comma < 0) {
					continue;
				}
				rows++;
				String addrText = line.substring(0, comma).trim();
				String name = line.substring(comma + 1).trim();
				if (name.startsWith("\"") && name.endsWith("\"") && name.length() > 1) {
					name = name.substring(1, name.length() - 1);
				}
				Address a = toAddr(addrText);
				Function f = (a == null) ? null : fm.getFunctionAt(a);
				if (f == null && a != null && create && !dry) {
					try {
						if (getInstructionAt(a) == null) {
							disassemble(a);
						}
						f = createFunction(a, name.startsWith("FUN_") ? null : name);
						if (f != null) {
							created++;
						}
					}
					catch (Exception e) {
						f = null;
					}
				}
				if (f == null) {
					missing++;
					if (!name.startsWith("FUN_")) {
						missingNamed++;
					}
					if (missingSample.size() < 15) {
						missingSample.add(addrText + " " + name);
					}
					continue;
				}
				if (name.startsWith("FUN_")) {
					skippedDefault++;
					continue;
				}
				String full = f.getName(true);
				if (f.getName().equals(name) || full.equals(name)) {
					same++;
					continue;
				}
				if (dry) {
					renamed++;
					continue;
				}
				try {
					int idx = name.lastIndexOf("::");
					if (idx > 0) {
						Namespace ns = NamespaceUtils.createNamespaceHierarchy(name.substring(0, idx),
							currentProgram.getGlobalNamespace(), currentProgram, SourceType.USER_DEFINED);
						f.setParentNamespace(ns);
						f.setName(name.substring(idx + 2), SourceType.USER_DEFINED);
					}
					else {
						f.setName(name, SourceType.USER_DEFINED);
					}
					renamed++;
				}
				catch (Exception e) {
					failed++;
					if (failedSample.size() < 15) {
						failedSample.add(addrText + " " + name + " : " + e.getMessage());
					}
				}
			}
		}
		finally {
			if (!dry) {
				currentProgram.endTransaction(tx, true);
			}
		}

		println("ApplyNames" + (dry ? " (dry run)" : "") + ": csv rows=" + rows + " renamed" + (dry ? "(would)" : "") +
			"=" + renamed + " already-correct=" + same + " csv-FUN_=" + skippedDefault +
			" created=" + created + " no-function-at-address=" + missing + " (named: " + missingNamed + ")" + " failed=" + failed);
		for (String s : missingSample) {
			println("  missing: " + s);
		}
		for (String s : failedSample) {
			println("  failed: " + s);
		}
	}
}
