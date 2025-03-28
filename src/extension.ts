import * as vscode from 'vscode';

type BracketPair = [string, string];
type TagMatchResult = { start: vscode.Position; end: vscode.Position } | null;

interface TagInfo {
    index: number;
    name: string;
    end: number;
}

function findEnclosingBrackets(
    document: vscode.TextDocument, 
    position: vscode.Position
): vscode.Range | null {
    const brackets: BracketPair[] = [['(', ')'], ['[', ']'], ['{', '}']];
    const text = document.getText();
    const offset = document.offsetAt(position);

    let bestRange: vscode.Range | null = null;

    // Search backward for opening bracket
    for (let i = offset; i >= 0; i--) {
        const char = text[i];
        const bracketPair = brackets.find(pair => pair[0] === char);
        
        if (bracketPair) {
            let depth = 1;
            for (let j = i + 1; j < text.length; j++) {
                const currentChar = text[j];
                if (currentChar === bracketPair[0]) {
                    depth++;
                } else if (currentChar === bracketPair[1]) {
                    depth--;
                    if (depth === 0) {
                        const range = new vscode.Range(
                            document.positionAt(i + 1),
                            document.positionAt(j)
                        );
                        // Track the most inner bracket pair that contains the cursor
                        if (range.contains(position) && 
                            (!bestRange || bestRange.contains(range))) {
                            bestRange = range;
                        }
                        break;
                    }
                }
            }
        }
    }
    return bestRange;
}

function findEnclosingTags(
    document: vscode.TextDocument,
    position: vscode.Position
): vscode.Range | null {
    const text = document.getText();
    const offset = document.offsetAt(position);

    const openingTagRegex = /<(\w+)[^>]*>/g;
    const tags: TagInfo[] = [];
    let match: RegExpExecArray | null;

    // Find all opening tags before cursor
    while ((match = openingTagRegex.exec(text)) !== null) {
        if (match.index > offset) break;
        if (match[1]) {
            tags.push({
                index: match.index,
                name: match[1],
                end: openingTagRegex.lastIndex
            });
        }
    }

    let bestRange: vscode.Range | null = null;

    // Check tags starting from innermost
    for (let i = tags.length - 1; i >= 0; i--) {
        const tag = tags[i];
        const closingTagRegex = new RegExp(`</${tag.name}>|<${tag.name}[^>]*>`, 'g');
        closingTagRegex.lastIndex = tag.end;

        let depth = 1;
        while ((match = closingTagRegex.exec(text)) !== null) {
            if (match[0].startsWith('</')) {
                depth--;
                if (depth === 0) {
                    // Create range for content between tags (excluding the tags themselves)
                    const range = new vscode.Range(
                        document.positionAt(tag.end),
                        document.positionAt(match.index)
                    );
                    // Track the most inner tag pair that contains the cursor
                    if (range.contains(position) && 
                        (!bestRange || bestRange.contains(range))) {
                        bestRange = range;
                    }
                    break;
                }
            } else {
                depth++;
            }
        }
    }

    return bestRange;
}

function compareRanges(a: vscode.Range, b: vscode.Range): number {
    // Prefer range that starts later (more inner)
    const startCompare = b.start.compareTo(a.start);
    if (startCompare !== 0) return startCompare;
    // If starts are equal, prefer range that ends earlier (more inner)
    return a.end.compareTo(b.end);
}

export function activate(context: vscode.ExtensionContext) {
    // Main command implementation
    const selectEnclosingCommand = vscode.commands.registerCommand('extension.selectEnclosing', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        const newSelections: vscode.Selection[] = [];

        editor.selections.forEach(selection => {
            const position = selection.active;
            const tagRange = findEnclosingTags(document, position);
            const bracketRange = findEnclosingBrackets(document, position);

            const candidates: vscode.Range[] = [];
            if (tagRange) candidates.push(tagRange);
            if (bracketRange) candidates.push(bracketRange);

            const bestRange = candidates
                .filter(r => r.contains(position))
                .sort(compareRanges)[0];

            newSelections.push(bestRange 
                ? new vscode.Selection(bestRange.start, bestRange.end)
                : selection
            );
        });

        editor.selections = newSelections;
    });

    context.subscriptions.push(selectEnclosingCommand);

    // Keybinding configuration management
    let keybindingDisposable: vscode.Disposable | null = null;
    
    const updateKeybinding = () => {
        const config = vscode.workspace.getConfiguration('bracketTagSelector');
        const keybinding = config.get<string>('shortcut', 'ctrl+[');

        // Clean up previous binding
        if (keybindingDisposable) {
            keybindingDisposable.dispose();
        }

        // Register new keybinding using input rules
        keybindingDisposable = vscode.commands.registerCommand(
            `bracketTagSelector.${keybinding}`,
            () => vscode.commands.executeCommand('extension.selectEnclosing')
        );

        context.subscriptions.push(keybindingDisposable);
    };

    // Initial setup
    updateKeybinding();

    // Watch for configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('bracketTagSelector.shortcut')) {
            updateKeybinding();
            vscode.window.showInformationMessage(
                'Bracket/Tag selector shortcut updated. Restart VS Code to fully apply changes.'
            );
        }
    }));
}

export function deactivate() {}