package br.tcc.farol;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Collections;
import org.junit.Test;

public class FarolFilesPluginTest {

    @Test
    public void keepsOrdinaryNames() {
        assertEquals("relatório final.pdf", FarolFilesPlugin.safeName("relatório final.pdf"));
    }

    @Test
    public void neutralizesPathsAndReservedCharacters() {
        String name = FarolFilesPlugin.safeName("../../data/x\\y:z*?\"<>|.txt");
        assertEquals("_.._data_x_y_z______.txt", name);
        assertTrue(!name.contains("/") && !name.contains("\\") && !name.startsWith("."));
    }

    @Test
    public void dropsControlCharactersAndHiddenPrefix() {
        assertEquals("nome__.txt", FarolFilesPlugin.safeName("nome\n\u0000.txt"));
        assertEquals("bashrc", FarolFilesPlugin.safeName(".bashrc"));
    }

    @Test
    public void fallsBackWhenNothingIsLeft() {
        assertEquals("arquivo-farol", FarolFilesPlugin.safeName(""));
        assertEquals("arquivo-farol", FarolFilesPlugin.safeName(" .. "));
    }

    @Test
    public void truncatesLongNamesKeepingTheExtension() {
        String name = FarolFilesPlugin.safeName(String.join("", Collections.nCopies(300, "a")) + ".pdf");
        assertEquals(120, name.length());
        assertTrue(name.endsWith(".pdf"));
    }
}
