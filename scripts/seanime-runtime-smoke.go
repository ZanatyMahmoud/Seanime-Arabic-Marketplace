package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/dop251/goja"
	"github.com/evanw/esbuild/pkg/api"
)

func main() {
	if len(os.Args) < 2 {
		panic("usage: smoke <provider.ts> ...")
	}
	failed := false
	for _, file := range os.Args[1:] {
		raw, err := os.ReadFile(file)
		if err != nil {
			fmt.Printf("SMOKE FAIL %s: read: %v\n", file, err)
			failed = true
			continue
		}
		src := strings.ReplaceAll(string(raw), "{{baseUrl}}", "https://example.com")
		result := api.Transform(src, api.TransformOptions{
			Target: api.ES2018,
			Loader: api.LoaderTS,
			Format: api.FormatDefault,
			MinifyWhitespace: true,
			MinifySyntax: true,
			Sourcemap: api.SourceMapNone,
		})
		if len(result.Errors) > 0 {
			fmt.Printf("SMOKE FAIL %s: esbuild: %v\n", file, result.Errors)
			failed = true
			continue
		}
		program, err := goja.Compile("", string(result.Code), false)
		if err != nil {
			fmt.Printf("SMOKE FAIL %s: goja compile: %v\n", file, err)
			failed = true
			continue
		}
		vm := goja.New()
		if _, err = vm.RunProgram(program); err != nil {
			fmt.Printf("SMOKE FAIL %s: goja run: %v\n", file, err)
			failed = true
			continue
		}
		v, err := vm.RunString("JSON.stringify(new Provider().getSettings())")
		if err != nil {
			fmt.Printf("SMOKE FAIL %s: Provider/getSettings: %v\n", file, err)
			failed = true
			continue
		}
		fmt.Printf("SMOKE OK %s: %s\n", file, v.String())
	}
	if failed {
		os.Exit(1)
	}
}
