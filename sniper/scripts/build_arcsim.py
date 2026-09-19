"""Compile ArcSim and store its RUNTIME bytecode — the probe is injected with an eth_call state override,
so the deployed-code blob (not the creation code) is what we need."""
import json
import pathlib

import solcx

SRC = pathlib.Path(__file__).resolve().parents[1] / "contracts" / "ArcSim.sol"
OUT = SRC.with_suffix(".build.json")

solcx.set_solc_version("0.8.26")
# four return values plus the leg arrays blow the stack in the legacy codegen: viaIR is required
compiled = solcx.compile_standard(
    {
        "language": "Solidity",
        "sources": {"ArcSim.sol": {"content": SRC.read_text()}},
        "settings": {
            "optimizer": {"enabled": True, "runs": 200},
            "viaIR": True,
            "outputSelection": {"*": {"*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"]}},
        },
    },
    solc_version="0.8.26",
)
art_ = compiled["contracts"]["ArcSim.sol"]["ArcSim"]
art = {"abi": art_["abi"], "bin": art_["evm"]["bytecode"]["object"], "bin-runtime": art_["evm"]["deployedBytecode"]["object"]}
runtime = art["bin-runtime"]
OUT.write_text(json.dumps({"abi": art["abi"], "bin": art["bin"], "runtime": runtime}, indent=2))
print(f"runtime bytecode: {len(runtime) // 2} bytes -> {OUT.name}")
