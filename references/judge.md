# Independent source check

Give this prompt to a fresh agent (the Agent tool) for any diagram that other people will read.
Fill in the three paths and the reader. The agent edits nothing; you fix what it reports.

```
Judge a diagram data file against its source. Source: <source path or URL>. Diagram data:
<path to data.json>. The diagram's reader: <who opens it and what they want to know>. Its rules
are the "Content rules" and "Source rules" sections of <skill path>/SKILL.md.

Read the whole source and the whole data file. Report:
1. Every statement in the data file that the source does not support or contradicts. Quote the
   data and say what the source says. Be strict: a reworded condition, a dropped exception, a
   widened "every" or "always", a sample stated as a general fact, an example turned into a rule,
   and a file or route the source does not tie to that step all count.
2. Facts the source states that this reader needs and the diagram leaves out.
3. Breaks of the content rules (plumbing in the grid, a box in a row the source does not give that
   action to, non-warning tags, a flag that is not a disagreement, missing source line).
4. Whether the reader would get the flow in a minute, and what you would merge or cut.
Edit no file.
```

Fix every item in 1 and 3, or say why it stands. Weigh 2 against the box count: a missing fact can
go in a box's `parts` or `notes` without adding a box.
