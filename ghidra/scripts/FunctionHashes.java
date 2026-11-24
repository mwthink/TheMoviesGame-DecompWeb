// Writes one line per function with fingerprints that survive a rebuild of the same source, so the functions of two
// binaries of one code base (MoviesSE.exe, StarMaker.exe) can be matched without relying on addresses or names.
// Read-only: does not modify the Ghidra program.
//
// Headless: analyzeHeadless <projectDir> <projectName> -process <program> -noanalysis -readOnly
//           -scriptPath <this folder> -postScript FunctionHashes.java <out.tsv>
//   (or as -postScript right after an -import, which runs it after the auto-analysis)
//
// Columns (tab separated): address, size in bytes, instruction count, name, h_mnem, h_norm, callCount, strings
//   h_mnem  = SHA-1 of the mnemonic sequence only (very tolerant: same code shape)
//   h_norm  = SHA-1 of mnemonics + operands where anything that refers to an address (calls, jumps, globals, strings), or is a
//             number of at least 0x100000, is replaced by "A", so relocated or renamed targets do not change it
//   strings = up to 6 string literals the function refers to (first 40 characters each, joined by |)
//
//@category Export

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSetView;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.symbol.Reference;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashSet;
import java.util.regex.Pattern;

public class FunctionHashes extends GhidraScript {

	private static final Pattern NUM = Pattern.compile("0x[0-9a-fA-F]+");

	private static String hex(byte[] b) {
		StringBuilder s = new StringBuilder();
		for (int i = 0; i < 10; i++) {          // 10 bytes of the SHA-1 are plenty
			s.append(String.format("%02x", b[i]));
		}
		return s.toString();
	}

	private static String normNumbers(String op) {
		java.util.regex.Matcher m = NUM.matcher(op);
		StringBuffer out = new StringBuffer();
		while (m.find()) {
			long v;
			try {
				v = Long.parseUnsignedLong(m.group().substring(2), 16);
			}
			catch (NumberFormatException e) {
				v = Long.MAX_VALUE;
			}
			m.appendReplacement(out, (v >= 0x100000L || v < 0) ? "A" : m.group());
		}
		m.appendTail(out);
		return out.toString();
	}

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length < 1) {
			printerr("usage: FunctionHashes.java <out.tsv>");
			return;
		}
		MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
		MessageDigest sha2 = MessageDigest.getInstance("SHA-1");
		int count = 0;
		try (BufferedWriter w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(new File(args[0])), StandardCharsets.UTF_8))) {
			for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
				if (monitor.isCancelled()) {
					break;
				}
				if (f.isExternal() || f.isThunk()) {
					continue;
				}
				AddressSetView body = f.getBody();
				sha1.reset();
				sha2.reset();
				int n = 0, calls = 0;
				LinkedHashSet<String> strs = new LinkedHashSet<>();
				InstructionIterator it = currentProgram.getListing().getInstructions(body, true);
				while (it.hasNext()) {
					Instruction ins = it.next();
					n++;
					String mn = ins.getMnemonicString();
					sha1.update((mn + ";").getBytes(StandardCharsets.US_ASCII));
					StringBuilder sb = new StringBuilder(mn);
					if (ins.getFlowType().isCall()) {
						calls++;
					}
					for (int i = 0; i < ins.getNumOperands(); i++) {
						boolean addr = false;
						for (Reference r : ins.getOperandReferences(i)) {
							if (r.isMemoryReference() || r.isExternalReference()) {
								addr = true;
								Data d = currentProgram.getListing().getDefinedDataAt(r.getToAddress());
								if (d != null && strs.size() < 6 && StringDataInstance.isString(d)) {
									String s = String.valueOf(d.getValue());
									strs.add(s.length() > 40 ? s.substring(0, 40) : s);
								}
							}
						}
						sb.append(' ').append(addr ? "A" : normNumbers(ins.getDefaultOperandRepresentation(i)));
					}
					sha2.update((sb + ";").getBytes(StandardCharsets.UTF_8));
				}
				Address a = f.getEntryPoint();
				String strings = String.join("|", strs).replace('\t', ' ').replace('\n', ' ').replace('\r', ' ');
				w.write(a.toString() + "\t" + body.getNumAddresses() + "\t" + n + "\t" + f.getName() + "\t" + hex(sha1.digest()) + "\t" +
					hex(sha2.digest()) + "\t" + calls + "\t" + strings + "\n");
				count++;
			}
		}
		println("FunctionHashes: wrote " + count + " functions to " + args[0]);
	}
}
